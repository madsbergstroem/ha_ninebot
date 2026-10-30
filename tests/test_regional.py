"""Synthetic fra-service exchanges; no cloud access, credentials or vehicle control."""

import base64
import hashlib
import json
import time

import pytest

from custom_components.ninebot import history_crypto as crypto
from custom_components.ninebot.exceptions import ErrorKind, NinebotAuthError, NinebotError
from custom_components.ninebot.regional import (
    CLIENT_KEY,
    REGIONS,
    RegionalClient,
    control_cmd,
    decode_business,
    passport_sign,
)

HOSTS = REGIONS["fra"]


def encrypted(keys: dict, payload: dict) -> bytes:
    """Answer a captured request the way the business layer does."""
    key = crypto.derive_key(*(keys[name].encode() for name in ("kd1", "kd2", "kd3", "kd4")))
    wrapper = json.dumps(
        {
            "data": crypto.android_b64(json.dumps(payload).encode()),
            "platform": 2,
            "timeStamp": int(time.time()),
        }
    ).encode()
    return json.dumps(
        {"r": base64.b64encode(crypto._aes_cbc_encrypt(key, wrapper)).decode()}
    ).encode()


class FakeService:
    """Route by URL; business answers are encrypted with the request's own keys."""

    def __init__(self, client: RegionalClient, routes: dict[str, dict]) -> None:
        self.routes = routes
        self.calls: list[tuple[str, dict]] = []
        self._keys: list[dict] = []
        prepare = client._prepare

        def capture(params, device_id, token, business_type):
            wire, keys, headers = prepare(params, device_id, token, business_type)
            self._keys.append(keys)
            return wire, keys, headers

        client._prepare = capture
        client._post = self.post

    async def post(self, url, data, headers):
        self.calls.append((url, headers))
        answer = self.routes[url]
        if url.startswith(HOSTS.passport):
            return json.dumps(answer).encode(), None
        return encrypted(self._keys.pop(0), answer), None


def test_passport_signature_adds_client_key_and_path():
    fields = {"username": "user@example.org", "timestamp": "1"}
    canonical = f"clientKey={CLIENT_KEY}&timestamp=1&url=/v6/user/login&username=user@example.org"
    assert passport_sign("/v6/user/login", fields) == hashlib.sha256(canonical.encode()).hexdigest()


def test_business_success_codes_and_rejections():
    _, keys = crypto.build_request(b"{}")
    assert decode_business(encrypted(keys, {"code": 1, "data": [{"wnumber": "v1"}]}), keys) == [
        {"wnumber": "v1"}
    ]
    assert decode_business(encrypted(keys, {"code": 0, "data": {}}), keys) == {}
    with pytest.raises(NinebotError) as rejected:
        decode_business(encrypted(keys, {"code": 340000, "desc": "4101"}), keys)
    assert rejected.value.kind is ErrorKind.SERVICE
    with pytest.raises(NinebotError) as malformed:
        decode_business(b'{"r": "not base64"}', keys)
    assert malformed.value.kind is ErrorKind.PROTOCOL


def test_control_command_is_one_rsa_block():
    cipher = base64.b64decode(control_cmd("fixture-vehicle-01", "engine_start"))
    assert len(cipher) == 128


async def test_login_writes_ninecli_compatible_session(tmp_path):
    client = RegionalClient(tmp_path, None, region="fra")
    service = FakeService(
        client,
        {
            HOSTS.passport + "/v6/user/login": {
                "resultCode": "90000",
                "data": {
                    "access_token": "AT",
                    "refresh_token": "RT",
                    "uuid": "U",
                    "region": "fra",
                    "accessTokenValidity": int(time.time() * 1000) + 3_600_000,
                },
            },
            HOSTS.business + "/user/user/login": {"code": 1, "data": {"uid": 42}},
        },
    )
    await client.async_login("user@example.org", "synthetic-password")
    tokens = json.loads((tmp_path / "tokens.json").read_text())
    config = json.loads((tmp_path / "config.json").read_text())
    assert tokens["business_uid"] == "42" and tokens["region"] == "fra"
    assert "synthetic-password" not in (tmp_path / "tokens.json").read_text()
    assert config["regionx"] == "fra" and len(config["device_id"]) == 32
    assert (tmp_path / "tokens.json").stat().st_mode & 0o777 == 0o600
    assert service.calls[1][1]["Regionx"] == "fra"
    assert await client.async_get_account() == {"username": "user@example.org", "region": "fra"}


async def test_rejected_password_is_an_authentication_error(tmp_path):
    client = RegionalClient(tmp_path, None, region="fra")
    FakeService(client, {HOSTS.passport + "/v6/user/login": {"resultCode": "90014"}})
    with pytest.raises(NinebotAuthError):
        await client.async_login("user@example.org", "wrong")


def session(tmp_path) -> None:
    (tmp_path / "config.json").write_text(json.dumps({"device_id": "d" * 32, "regionx": "fra"}))
    validity = int(time.time() * 1000) + 3_600_000
    (tmp_path / "tokens.json").write_text(
        json.dumps({"access_token": "AT", "business_uid": "42", "accessTokenValidity": validity})
    )


async def test_vehicle_lines_route_battery_and_control(tmp_path):
    session(tmp_path)
    motor, ebike = HOSTS.lines
    client = RegionalClient(tmp_path, None, region="fra")
    service = FakeService(
        client,
        {
            motor + "/vehicle/binding/my-vehicle": {
                "code": 1,
                "data": [{"wnumber": "fixture-vehicle-01", "vehicle_type": 81}],
            },
            ebike + "/vehicle/binding/my-vehicle": {"code": 1, "data": []},
            motor + "/v6/vehicle/battery-info": {"code": 1, "data": {"electricity": 88}},
            motor + "/vehicle/vehicle/desktop-component": {"code": 340000, "desc": "4101"},
            motor + "/devices/control/engine_start": {"code": 1, "data": {}},
        },
    )
    vehicles = await client.async_list_vehicles()
    assert [vehicle["wnumber"] for vehicle in vehicles] == ["fixture-vehicle-01"]
    assert client.vehicle_discovery_complete is True
    assert await client.async_get_battery("fixture-vehicle-01") == {"electricity": 88}
    with pytest.raises(NinebotError) as status:
        await client.async_get_status("fixture-vehicle-01")
    assert status.value.kind is ErrorKind.SERVICE
    await client.async_control("fixture-vehicle-01", "engine/start")
    assert service.calls[-1][0] == motor + "/devices/control/engine_start"
    with pytest.raises(ValueError):
        await client.async_control("fixture-vehicle-01", "unknown")
    with pytest.raises(NinebotError):
        await client.async_get_travel("fixture-vehicle-01", "202610")


async def test_missing_session_requires_reauthentication(tmp_path):
    client = RegionalClient(tmp_path, None, region="fra")
    with pytest.raises(NinebotAuthError):
        await client.async_get_battery("fixture-vehicle-01")


def test_unknown_region_is_rejected(tmp_path):
    with pytest.raises(NinebotError):
        RegionalClient(tmp_path, None, region="bj")


def test_regional_backend_never_schedules_unverified_groups():
    from custom_components.ninebot.backend import RegionalBackend
    from custom_components.ninebot.coordinator import supported_demand
    from custom_components.ninebot.demand import PollingDemand
    from custom_components.ninebot.raw import Endpoint

    assert RegionalBackend.endpoints == frozenset({Endpoint.VEHICLES, Endpoint.BATTERY})
    demand = PollingDemand(frozenset({"status", "battery", "travel"}), True, ("entity_status",))
    assert supported_demand(demand, RegionalBackend.endpoints).groups == frozenset({"battery"})
    assert supported_demand(demand, frozenset(Endpoint)) is demand
