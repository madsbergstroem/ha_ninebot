"""Direct HTTPS session for accounts on the Frankfurt (fra) Ninebot service.

ninecli 0.1.7 fixes every host to the mainland-China service, so accounts
registered outside China cannot sign in (#2). This client provides the
NinecliClient surface without a subprocess. Wire encoding reuses
history_crypto; the passport signature follows kxn/ninebot-recon (MIT).

Observed on the fra service (2026-10-30): passport answers resultCode
"90000", business answers code 1, and the vehicle list and battery of an
E125S come from the motor host. Status (desktop-component) answered
340000/4101 for every tested field set; it stays unavailable until verified.
Control commands follow ninecli 0.1.7 BuildControlCmd and are physically
unverified.
"""

import asyncio
import base64
import hashlib
import json
import os
import secrets
import time
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiohttp

from . import history_crypto as crypto
from .const import CLI_TIMEOUT, MAX_RESPONSE_BYTES
from .exceptions import ErrorKind, NinebotAuthError, NinebotError
from .http_policy import rate_limit_delay
from .native_history import CLIENT_VERSION, RN_VERSION, _read


@dataclass(frozen=True)
class RegionHosts:
    passport: str
    business: str
    lines: tuple[str, ...]  # Vehicle-list hosts; the first also serves unknown vehicles.
    country: str


REGIONS = {
    "fra": RegionHosts(
        "https://api-passport-fra.ninebot.com",
        "https://api-jhcx-v6-fra.ninebot.com",
        ("https://steeldust-fra.ninebot.com", "https://ebike-fra.ninebot.com"),
        "DE",
    ),
}

CLIENT_KEY = "e177176a-3b3e-1513-e26e-d1123034cb66"
OS_VERSION = "13"
# Observed with an e-mail account; phone accounts may need their own code.
AREA_CODE = "49"
PASSPORT_OK = "90000"
PASSPORT_REJECTED = frozenset({"00002", "90014"})  # Unknown account, wrong password.
LOGIN_PATH = "/v6/user/login"
REFRESH_PATH = "/v3/user/refresh"
BUSINESS_LOGIN_PATH = "/user/user/login"
VEHICLES_PATH = "/vehicle/binding/my-vehicle"
BATTERY_PATH = "/v6/vehicle/battery-info"
STATUS_PATH = "/vehicle/vehicle/desktop-component"
CONTROL_PATH = "/devices/control/"
# ninecli action -> (URL suffix, payload operation), as described by ninecli 0.1.7.
CONTROL = {
    "engine/start": ("engine_start", "engine_start"),
    "engine/stop": ("engine_stop", "engine_stop"),
    "bell": ("bell", "bell"),
    "buck": ("open_buck", "buck"),
}
# Second RSA-1024 key that ninecli 0.1.7 crypto.init parses for BuildControlCmd.
CONTROL_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC6maFY3dEhgav1147RW2gVWzCv
agkiRySnCDRSTM67YhHvLcrUSMnngxJl0A2liFLJydpn65E58oh0Phtu+t4Kkkfe
GIHsr931wRMRtkila4F/RF3U5pqSt42k/10U087QEhGMGvdOzF/5ziGXJod6ovBx
yk6pJlzNhxLTVJSzkQIDAQAB
-----END PUBLIC KEY-----"""
REFRESH_MARGIN = 300


def passport_sign(path: str, fields: dict[str, str]) -> str:
    signed = {**fields, "clientKey": CLIENT_KEY, "url": path}
    canonical = "&".join(f"{key}={value}" for key, value in sorted(signed.items()))
    return hashlib.sha256(canonical.encode()).hexdigest()


def control_cmd(sn: str, operation: str) -> str:
    payload = {"sn": sn, "operation": operation, "request_time": int(time.time() * 1000)}
    plain = json.dumps(payload, separators=(",", ":")).encode()
    return crypto.android_b64(crypto._rsa_encrypt(CONTROL_PUBLIC_KEY_PEM, plain))


def _inflate(body: bytes, encoding: str | None) -> bytes:
    if encoding == "gzip":
        inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
        body = inflater.decompress(body, MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES or not inflater.eof or inflater.unused_data:
            raise ValueError("Compression budget")
    elif encoding not in (None, "identity"):
        raise ValueError("Unsupported compression")
    return body


def decode_business(body: bytes, keys: dict, encoding: str | None = None) -> Any:
    """Return business data; list payloads are valid unlike the history page."""
    try:
        outer = json.loads(_inflate(body, encoding))
        if not isinstance(outer, dict) or not isinstance(outer.get("r"), str):
            raise ValueError("Wire shape")
        cipher = base64.b64decode(outer["r"], validate=True)
        if not cipher or len(cipher) % 16:
            raise ValueError("Cipher shape")
        response = json.loads(crypto.decrypt_wire_response(outer, keys))
        if not isinstance(response, dict) or type(response.get("code")) is not int:
            raise ValueError("Business shape")
    except (ValueError, TypeError, KeyError, RecursionError, zlib.error):
        raise NinebotError(ErrorKind.PROTOCOL) from None
    if response["code"] not in (0, 1):
        # 340000/4101 (status) and 1005 (session elsewhere) are not credential proof.
        raise NinebotError(ErrorKind.SERVICE)
    return response.get("data")


class RegionalClient:
    """One serialized session per account; tokens live in the managed directory."""

    def __init__(
        self,
        config_dir: Path,
        session: aiohttp.ClientSession,
        *,
        region: str,
        timeout: float = CLI_TIMEOUT,
    ) -> None:
        if region not in REGIONS:
            raise NinebotError(ErrorKind.PLATFORM)
        self.config_dir = config_dir
        self.region = region
        self._hosts = REGIONS[region]
        self._session = session
        self._timeout = timeout
        self._lock = asyncio.Lock()
        self._closed = False
        self._lines: dict[str, str] = {}
        self.vehicle_discovery_complete = False

    # -- files -------------------------------------------------------------

    def _load(self) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            config = json.loads(_read(self.config_dir / "config.json"))
            tokens = json.loads(_read(self.config_dir / "tokens.json"))
        except (OSError, ValueError):
            raise NinebotAuthError() from None
        if not isinstance(config, dict) or not isinstance(tokens, dict):
            raise NinebotAuthError()
        if (
            not isinstance(config.get("device_id"), str)
            or not tokens.get("access_token")
            or not tokens.get("business_uid")
        ):
            raise NinebotAuthError()
        return config, tokens

    def _write(self, name: str, value: dict[str, Any]) -> None:
        target = self.config_dir / name
        temporary = self.config_dir / f".{name}.{secrets.token_hex(4)}"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False)
        os.replace(temporary, target)

    # -- transport ---------------------------------------------------------

    async def _post(
        self, url: str, data: bytes, headers: dict[str, str]
    ) -> tuple[bytes, str | None]:
        if self._closed:
            raise NinebotError(ErrorKind.CLOSED)
        try:
            async with self._session.post(
                url,
                data=data,
                headers=headers,
                proxy=None,
                allow_redirects=False,
                auto_decompress=False,
                ssl=True,
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            ) as response:
                body = bytearray()
                async for part in response.content.iter_chunked(16384):
                    if len(body) + len(part) > MAX_RESPONSE_BYTES:
                        raise NinebotError(ErrorKind.PROTOCOL)
                    body.extend(part)
                if response.status == 401:
                    raise NinebotAuthError()
                if response.status == 429:
                    raise NinebotError(
                        ErrorKind.SERVICE,
                        retry_after=rate_limit_delay(
                            response.headers.get("Retry-After"), datetime.now(UTC)
                        ),
                    )
                if response.status != 200:
                    raise NinebotError(ErrorKind.SERVICE, retryable=response.status >= 500)
                return bytes(body), response.headers.get("Content-Encoding")
        except (aiohttp.ClientError, TimeoutError):
            raise NinebotError(ErrorKind.CONNECTION, retryable=True) from None

    async def _passport(self, path: str, body: dict[str, str]) -> dict[str, Any]:
        now = str(int(time.time() * 1000))
        fields = {
            **body,
            "app_version": CLIENT_VERSION,
            "os": "Android",
            "os_language": "zh-hans-cn",
            "os_version": OS_VERSION,
            "timestamp": now,
        }
        headers = {
            "App_version": CLIENT_VERSION,
            "Clientid": "vehicle_app_prod",
            "Content-Type": "application/json; charset=UTF-8",
            "Os": "Android",
            "Os_language": "zh-hans-cn",
            "Os_version": OS_VERSION,
            "Accept-Encoding": "gzip",
            "Timestamp": now,
            "Sign": passport_sign(path, fields),
        }
        raw, encoding = await self._post(
            self._hosts.passport + path, json.dumps(body, separators=(",", ":")).encode(), headers
        )
        try:
            response = json.loads(_inflate(raw, encoding))
        except (ValueError, zlib.error):
            raise NinebotError(ErrorKind.PROTOCOL) from None
        if not isinstance(response, dict):
            raise NinebotError(ErrorKind.PROTOCOL)
        if response.get("resultCode") in PASSPORT_REJECTED:
            raise NinebotAuthError()
        data = response.get("data")
        if (response.get("resultCode") != PASSPORT_OK and response.get("code") != 0) or not (
            isinstance(data, dict) and data.get("access_token")
        ):
            raise NinebotError(ErrorKind.SERVICE)
        return data

    def _prepare(
        self, params: dict[str, Any], device_id: str, token: str | None, business_type: int
    ) -> tuple[bytes, dict, dict[str, str]]:
        now = int(time.time() * 1000)
        inner: dict[str, Any] = dict(
            sys_language="zh-hans-cn",
            client_ver=CLIENT_VERSION,
            device_id=device_id,
            regionx=self.region,
            language="zh",
            ostype="and",
            lang="zh",
            platform_ver="13 Xiaomi",
            platform="android",
            login_country=self._hosts.country,
        )
        inner.update(params)
        inner.update(serviceTime=now, nonce=crypto.gen_nonce())
        wire, keys = crypto.build_request(crypto.build_inner(inner).encode())
        headers = {
            "User-Agent": "okhttp/4.9.1",
            "Accept-Encoding": "gzip",
            "Business-Type": str(business_type),
            "Cache-Control": "no-cache",
            "Client-Ver": CLIENT_VERSION,
            "Content-Type": "text/html;charset=UTF-8",
            "Debug": "0",
            "Device-Id": device_id,
            "Language": "zh",
            "Login-Country": self._hosts.country,
            "Need_decrypt": "1",
            "Ninebot-Version": "2",
            "Platform": "Android",
            "Platform-Ver": OS_VERSION,
            "Regionx": self.region,
            "Request-Id": secrets.token_hex(16),
            "Service-Time": str(now),
            "Sys-Language": "zh-hans-cn",
        }
        if token:
            headers.update(
                {
                    "Access_token": token,
                    "Accept": "application/json",
                    "Rn-Module": "Track",
                    "Rn-Ver": RN_VERSION,
                    "Rn-Version": "0",
                }
            )
        return json.dumps(wire, separators=(",", ":")).encode(), keys, headers

    async def _business(
        self,
        host: str,
        path: str,
        params: dict[str, Any],
        device_id: str,
        token: str | None,
        business_type: int = 2,
    ) -> Any:
        wire, keys, headers = await asyncio.to_thread(
            self._prepare, params, device_id, token, business_type
        )
        body, encoding = await self._post(host + path, wire, headers)
        return await asyncio.to_thread(decode_business, body, keys, encoding)

    async def _session_tokens(self) -> tuple[str, dict[str, Any]]:
        """Refresh shortly before expiry; a failed refresh requires reauthentication."""
        config, tokens = await asyncio.to_thread(self._load)
        try:
            expiry = int(tokens.get("accessTokenValidity") or 0) / 1000
        except (TypeError, ValueError):
            expiry = 0
        if expiry and expiry - time.time() < REFRESH_MARGIN:
            data = await self._passport(
                REFRESH_PATH,
                {
                    "access_token": str(tokens["access_token"]),
                    "device": "ANDROID",
                    "refresh_token": str(tokens.get("refresh_token", "")),
                },
            )
            tokens = {
                **tokens,
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token") or tokens.get("refresh_token", ""),
                "accessTokenValidity": str(data.get("accessTokenValidity", "")),
                "saved_at": int(time.time()),
            }
            await asyncio.to_thread(self._write, "tokens.json", tokens)
        return config["device_id"], tokens

    async def _vehicle_request(self, sn: str, path: str, params: dict[str, Any]) -> Any:
        async with self._lock:
            device_id, tokens = await self._session_tokens()
            return await self._business(
                self._lines.get(sn, self._hosts.lines[0]),
                path,
                {"access_token": tokens["access_token"], "uid": tokens["business_uid"], **params},
                device_id,
                tokens["access_token"],
            )

    # -- NinecliClient surface --------------------------------------------

    async def async_close(self) -> None:
        self._closed = True

    async def async_login(self, account: str, password: str) -> None:
        async with self._lock:
            data = await self._passport(
                LOGIN_PATH,
                {
                    "areaCode": AREA_CODE,
                    "device": "ANDROID",
                    "password": password,
                    "username": account,
                },
            )
            device_id = secrets.token_hex(16)
            tokens = {
                "uuid": data.get("uuid", ""),
                "username": account,
                "region": data.get("region") or self.region,
                "areaCode": AREA_CODE,
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", ""),
                "accessTokenValidity": str(data.get("accessTokenValidity", "")),
            }
            result = await self._business(
                self._hosts.business,
                BUSINESS_LOGIN_PATH,
                {
                    "access_token": tokens["access_token"],
                    "uuid": tokens["uuid"],
                    "token": tokens["access_token"],
                    "refresh_token": tokens["refresh_token"],
                    "region": tokens["region"],
                },
                device_id,
                None,
                business_type=0,
            )
            if not isinstance(result, dict) or not result.get("uid"):
                raise NinebotError(ErrorKind.PROTOCOL)
            tokens["business_uid"] = str(result["uid"])
            tokens["saved_at"] = int(time.time())
            await asyncio.to_thread(
                self._write, "config.json", {"device_id": device_id, "regionx": self.region}
            )
            await asyncio.to_thread(self._write, "tokens.json", tokens)

    async def async_get_account(self) -> Any:
        _, tokens = await asyncio.to_thread(self._load)
        return {"username": tokens.get("username"), "region": tokens.get("region")}

    async def async_send_login_code(self, account: str) -> None:
        raise NinebotError(ErrorKind.PLATFORM)

    async def async_consume_login_code(self, account: str, code: str) -> None:
        raise NinebotError(ErrorKind.PLATFORM)

    async def async_list_vehicles(self) -> Any:
        async with self._lock:
            device_id, tokens = await self._session_tokens()
            found: dict[str, dict[str, Any]] = {}
            lines: dict[str, str] = {}
            failure: NinebotError | None = None
            for host in self._hosts.lines:
                try:
                    data = await self._business(
                        host,
                        VEHICLES_PATH,
                        {
                            "access_token": tokens["access_token"],
                            "uid": tokens["business_uid"],
                            "vehicle_type": "",
                        },
                        device_id,
                        tokens["access_token"],
                    )
                except NinebotAuthError:
                    raise
                except NinebotError as err:
                    failure = err
                    continue
                if not isinstance(data, list):
                    raise NinebotError(ErrorKind.PROTOCOL)
                for vehicle in data:
                    if isinstance(vehicle, dict) and isinstance(vehicle.get("wnumber"), str):
                        found.setdefault(vehicle["wnumber"], vehicle)
                        lines.setdefault(vehicle["wnumber"], host)
            if failure is not None and not found:
                raise failure
            self._lines = lines
            self.vehicle_discovery_complete = failure is None
            return list(found.values())

    async def async_get_status(self, sn: str) -> Any:
        data = await self._vehicle_request(sn, STATUS_PATH, {"sn": sn, "wnumber": sn})
        if not isinstance(data, dict):
            raise NinebotError(ErrorKind.PROTOCOL)
        return data

    async def async_get_status_once(self, sn: str) -> Any:
        return await self.async_get_status(sn)

    async def async_get_battery(self, sn: str) -> Any:
        data = await self._vehicle_request(sn, BATTERY_PATH, {"wnumber": sn})
        if not isinstance(data, dict):
            raise NinebotError(ErrorKind.PROTOCOL)
        return data

    async def async_get_travel(self, sn: str, month: str) -> Any:
        # The fra travel host is unknown; cn-cbu-gateway serves China only.
        raise NinebotError(ErrorKind.SERVICE)

    async def async_get_travel_page(
        self, sn: str, month: str, page: int, *, expected_uid: str
    ) -> Any:
        raise NinebotError(ErrorKind.SERVICE)

    async def async_get_trip_detail(self, sn: str, detail_id: str) -> Any:
        raise NinebotError(ErrorKind.SERVICE)

    async def async_control(self, sn: str, action: str) -> None:
        """One attempt only. A timeout leaves the physical outcome unknown."""
        if action not in CONTROL:
            raise ValueError("Unsupported action")
        suffix, operation = CONTROL[action]
        cmd = await asyncio.to_thread(control_cmd, sn, operation)
        await self._vehicle_request(
            sn, CONTROL_PATH + suffix, {"wnumber": sn, "operation": operation, "cmd": cmd}
        )
