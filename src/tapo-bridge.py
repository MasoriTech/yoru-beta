#!/usr/bin/env python3
"""Small JSON-stdin bridge for python-kasa. Credentials never appear in argv."""
import asyncio
import json
import sys


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def serialise(device):
    from kasa import Module
    light = device.modules.get(Module.Light)
    try:
        hsv = light.hsv if light and has_light_feature(light, "hsv") else None
    except Exception:
        hsv = None
    features = []
    if light:
        for name in ("brightness", "color_temp", "hsv"):
            if has_light_feature(light, name):
                features.append(name)
    try:
        is_on = bool(device.is_on)
    except Exception:
        is_on = False
    try:
        brightness = int(light.brightness) if light and has_light_feature(light, "brightness") else None
    except Exception:
        brightness = None
    try:
        color_temp = int(light.color_temp) if light and has_light_feature(light, "color_temp") else None
    except Exception:
        color_temp = None
    try:
        hsv_data = {"hue": int(hsv.hue), "saturation": int(hsv.saturation), "value": int(hsv.value)} if hsv else None
    except Exception:
        hsv_data = None
    try:
        rssi = int(device.rssi) if device.rssi is not None else None
    except Exception:
        rssi = None
    try:
        ssid = str(device.ssid or "")
    except Exception:
        ssid = ""
    effects = []
    effect_value = ""
    effect_module = device.modules.get(Module.LightEffect)
    if effect_module:
        try:
            effects = [str(item) for item in (effect_module.effect_list or [])][:20]
            effect_value = str(effect_module.effect or "")
        except Exception:
            pass
    features_map = getattr(device, "features", {})
    presets = []
    preset_value = ""
    try:
        preset_feature = features_map.get("light_preset")
        if preset_feature:
            presets = [str(item) for item in (preset_feature.choices or [])][:12]
            preset_value = str(preset_feature.value or "")
    except Exception:
        pass
    def feature_value(key):
        try:
            item = features_map.get(key)
            return item.value if item else None
        except Exception:
            return None
    auto_white_modes = []
    try:
        for key, feature in features_map.items():
            if "auto" in str(key).lower() and "white" in str(key).lower():
                auto_white_modes = [str(item) for item in (getattr(feature, "choices", []) or [])][:8]
                if not auto_white_modes and feature.value is not None:
                    auto_white_modes = [str(feature.value)]
                break
    except Exception:
        pass
    try:
        available_features = [str(key) for key in features_map.keys()][:40]
    except Exception:
        available_features = []
    return {
        "ok": True,
        "host": str(device.host),
        "alias": str(device.alias or device.model or "Lâmpada Tapo"),
        "model": str(device.model or "Unknown"),
        "isOn": is_on,
        "brightness": brightness,
        "colorTemp": color_temp,
        "hsv": hsv_data,
        "rssi": rssi,
        "ssid": ssid,
        "features": features + available_features,
        "effects": effects,
        "effect": effect_value,
        "presets": presets,
        "preset": preset_value,
        "smoothTransitionOn": feature_value("smooth_transition_on"),
        "smoothTransitionOff": feature_value("smooth_transition_off"),
        "autoWhiteModes": auto_white_modes,
        "overheated": feature_value("overheated"),
        "signalLevel": feature_value("signal_level"),
    }


def has_light_feature(light, name):
    """Compatível com versões diferentes do python-kasa (has_feature ou is_* clássicos)."""
    if not light:
        return False
    try:
        return bool(light.has_feature(name))
    except Exception:
        pass
    legacy = {"brightness": "is_dimmable", "color_temp": "is_variable_color_temp", "hsv": "is_color"}
    try:
        return bool(getattr(light, legacy.get(name, ""), False))
    except Exception:
        return False


def is_light(device):
    try:
        from kasa import Module
        return Module.Light in device.modules
    except Exception:
        return "L5" in str(getattr(device, "model", "")).upper() or "L9" in str(getattr(device, "model", "")).upper()


def friendly_error(exc):
    """Traduz erros comuns do python-kasa para mensagens acionáveis em português."""
    name = type(exc).__name__
    text = str(exc).strip()
    low = text.lower()
    if name in ("AuthenticationError", "AuthenticationException") or "authenticat" in low or "invalid_credentials" in low or "-1501" in low:
        return "A lâmpada recusou o e-mail/senha. Use exatamente o e-mail e a senha da conta TP-Link/Tapo (a mesma do app Tapo, com maiúsculas/minúsculas corretas) e salve o acesso de novo."
    if name in ("TimeoutError", "TimeoutException") or "timed out" in low or "timeout" in low:
        return "A lâmpada não respondeu a tempo. Confirme que ela está ligada no interruptor, no mesmo Wi-Fi do computador (sem rede de convidados/isolamento) e tente informar o IP dela."
    if name in ("ConnectionError", "ConnectionRefusedError", "OSError") or "cannot connect" in low or "connection" in low:
        return "Não consegui conectar à lâmpada. Confira o IP, a rede Wi-Fi e se o computador e a lâmpada estão na mesma rede local."
    if name == "UnsupportedDeviceError" or "unsupported" in low:
        return "Esse dispositivo ou firmware ainda não é suportado pelo python-kasa instalado. Atualize com: py -3 -m pip install --user --upgrade python-kasa"
    return (text or name or "Falha ao comunicar com a lâmpada Tapo.")[:600]


def make_credentials(email, password):
    from kasa import Credentials
    return Credentials(email, password)


SUBNETS = []


async def port_open(host, port=80, timeout=0.8):
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


async def sweep_subnets(creds, subnets):
    """Plano B: quando o broadcast não acha nada (roteador/firewall bloqueando), testa cada IP da rede local
    (porta 80, usada pelas Tapo) e conversa direto com os que responderem."""
    import ipaddress
    from kasa import Discover
    hosts, own = [], set()
    for cidr in (subnets or [])[:4]:
        try:
            iface = ipaddress.ip_interface(str(cidr))
        except Exception:
            continue
        own.add(str(iface.ip))
        net = iface.network
        if net.prefixlen < 22:
            net = ipaddress.ip_network(f"{iface.ip}/24", strict=False)
        hosts.extend(str(h) for h in net.hosts())
    hosts = [h for h in dict.fromkeys(hosts) if h not in own][:1024]
    sem = asyncio.Semaphore(96)

    async def probe(h):
        async with sem:
            return h if await port_open(h) else None

    candidates = [h for h in await asyncio.gather(*(probe(h) for h in hosts)) if h]

    async def single(h):
        try:
            return h, await Discover.discover_single(h, credentials=creds, discovery_timeout=4, timeout=8)
        except Exception as exc:
            low = (type(exc).__name__ + " " + str(exc)).lower()
            if "authenticat" in low or "credential" in low:
                raise
            return h, None

    found, auth_error = {}, None
    for res in await asyncio.gather(*(single(h) for h in candidates), return_exceptions=True):
        if isinstance(res, Exception):
            auth_error = auth_error or res
        elif res and res[1] is not None:
            found[res[0]] = res[1]
    if not found and auth_error:
        raise auth_error
    return found


async def discover_all(creds, broadcasts):
    """Descobre dispositivos em todas as interfaces de rede ativas (VPN/WSL/Hyper-V não atrapalham)."""
    from kasa import Discover
    targets = [t for t in (broadcasts or []) if isinstance(t, str) and t][:8] or ["255.255.255.255"]
    if "255.255.255.255" not in targets:
        targets.append("255.255.255.255")

    async def one(target):
        try:
            return await Discover.discover(target=target, credentials=creds, discovery_timeout=4, on_unsupported=None)
        except TypeError:
            return await Discover.discover(target=target, credentials=creds, discovery_timeout=4)
        except Exception:
            return {}

    merged = {}
    for batch in await asyncio.gather(*(one(t) for t in targets)):
        for host, dev in (batch or {}).items():
            merged.setdefault(host, dev)
    if not merged and SUBNETS:
        merged = await sweep_subnets(creds, SUBNETS)
    return merged


def is_auth_error(exc):
    low = (type(exc).__name__ + " " + str(exc)).lower()
    return "authenticat" in low or "credential" in low or "invalid_credentials" in low or "-1501" in low


async def diagnose_host(host):
    """Diz se o IP responde nas portas que a Tapo usa (80 = HTTP/KLAP, 443 = HTTPS dos firmwares novos)."""
    p80, p443 = await asyncio.gather(port_open(host, 80, 2.0), port_open(host, 443, 2.0))
    if p80 or p443:
        return f"o IP {host} responde (porta {'80' if p80 else '443'}), mas a Tapo não aceitou a conexão"
    return f"o IP {host} não respondeu nas portas 80/443 (confira o IP no app Tapo, se o PC está na mesma rede/sub-rede e se o Firewall do Windows permite o Python)"


async def connect_host(host, creds):
    """Conecta direto ao IP informado. Tenta, em ordem: descoberta UDP, teste automático de todos os protocolos
    e conexão manual (KLAP/AES, HTTP/HTTPS). Devolve (dispositivo|None, último erro|None); erro de senha sobe."""
    from kasa import Discover
    last = None
    try:
        return await Discover.discover_single(host, credentials=creds, discovery_timeout=5, timeout=10), None
    except Exception as exc:
        if is_auth_error(exc):
            raise
        last = exc
    # descoberta UDP bloqueada (roteador/firewall): conversa direto por TCP testando os protocolos da Tapo
    if hasattr(Discover, "try_connect_all"):
        try:
            dev = await Discover.try_connect_all(host, credentials=creds, timeout=10)
            if dev is not None:
                return dev, None
        except Exception as exc:
            if is_auth_error(exc):
                raise
            last = exc
    try:
        from kasa import Device, DeviceConfig
        from kasa.deviceconfig import DeviceConnectionParameters, DeviceFamily, DeviceEncryptionType
        combos = [
            (DeviceEncryptionType.Klap, 2, False), (DeviceEncryptionType.Klap, 2, True),
            (DeviceEncryptionType.Aes, 2, False), (DeviceEncryptionType.Aes, 2, True),
            (DeviceEncryptionType.Klap, None, False), (DeviceEncryptionType.Aes, None, False),
        ]
        for enc, login, https in combos:
            dev = None
            try:
                cfg = DeviceConfig(host=host, timeout=10, credentials=creds,
                                   connection_type=DeviceConnectionParameters(DeviceFamily.SmartTapoBulb, enc, login_version=login, https=https))
                dev = await Device.connect(config=cfg)
                await dev.update()
                return dev, None
            except Exception as exc:
                if is_auth_error(exc):
                    raise
                last = exc
                if dev is not None:
                    try:
                        await dev.disconnect()
                    except Exception:
                        pass
    except ImportError:
        pass
    return None, last


async def refresh_lights(found):
    """Atualiza cada dispositivo e devolve (lâmpadas, erros)."""
    lights, errors = [], []

    async def upd(dev):
        try:
            await dev.update()
            if is_light(dev):
                lights.append(dev)
        except Exception as exc:
            errors.append(exc)

    await asyncio.gather(*(upd(d) for d in found.values()))
    lights.sort(key=lambda d: (0 if "L530" in str(d.model or "").upper() else 1, str(d.host)))
    return lights, errors


async def main(payload):
    try:
        from kasa import Discover, Module
    except Exception as exc:
        emit({"ok": False, "needsInstall": True, "error": "Biblioteca python-kasa não instalada. Instale com: py -3 -m pip install --user python-kasa", "detail": str(exc)[:240]})
        return

    if str(payload.get("action") or "").lower() == "check":
        try:
            import kasa
            if not hasattr(Module, "Light"):
                emit({"ok": False, "installed": True, "needsInstall": True, "version": str(getattr(kasa, "__version__", "")), "error": "O python-kasa instalado é antigo. Atualize com: py -3 -m pip install --user --upgrade python-kasa (requer Python 3.11+)."})
                return
            emit({"ok": True, "installed": True, "version": str(getattr(kasa, "__version__", "disponível")), "python": sys.version.split()[0]})
        except Exception as exc:
            emit({"ok": False, "installed": False, "needsInstall": True, "error": "Biblioteca python-kasa não instalada. Instale com: py -3 -m pip install --user python-kasa", "detail": str(exc)[:240]})
        return

    email = str(payload.get("email") or "").strip()
    password = str(payload.get("password") or "")
    host = str(payload.get("host") or "").strip()
    action = str(payload.get("action") or "state").lower()
    args = payload.get("args") if isinstance(payload.get("args"), dict) else {}

    if not email or not password:
        emit({"ok": False, "error": "Configure o e-mail e a senha da conta TP-Link/Tapo no Yoru."})
        return

    broadcasts = payload.get("broadcasts") if isinstance(payload.get("broadcasts"), list) else []
    global SUBNETS
    SUBNETS = [str(x) for x in payload.get("subnets", []) if isinstance(x, str)] if isinstance(payload.get("subnets"), list) else []
    opened = []
    try:
        creds = make_credentials(email, password)
        if action == "discover":
            found, host_error = {}, None
            if host:  # IP informado: conversa direto com ele antes de procurar pela rede
                direct, host_error = await connect_host(host, creds)
                if direct is not None:
                    found[str(direct.host)] = direct
            if not found:
                found = await discover_all(creds, broadcasts)
            opened.extend(found.values())
            lights, errors = await refresh_lights(found)
            if not lights and host:
                detail = await diagnose_host(host)
                why = friendly_error(host_error) if host_error else ""
                emit({"ok": False, "error": f"Não consegui conectar à lâmpada no IP {host}: {detail}." + (f" Detalhe: {why}" if why else "")})
                return
            if not lights and errors:
                raise errors[0]
            items = [serialise(d) for d in lights]
            emit({"ok": True, "items": items, "message": f"{len(items)} lâmpada(s) Tapo encontrada(s)." if items else "Nenhuma lâmpada Tapo respondeu nem na varredura da rede. Confira se está ligada no interruptor, no mesmo Wi-Fi de 2,4 GHz (sem rede de convidados/isolamento) e libere o Python no Firewall do Windows; ou informe o IP dela.", "retryable": not bool(items)})
            return

        device = None
        host_error = None
        if host:
            device, host_error = await connect_host(host, creds)  # IP pode ter mudado (DHCP): se falhar, procura pela rede
        if device is None:
            found = await discover_all(creds, broadcasts)
            opened.extend(found.values())
            lights, errors = await refresh_lights(found)
            if not lights:
                if host:
                    detail = await diagnose_host(host)
                    why = friendly_error(host_error) if host_error else ""
                    emit({"ok": False, "error": f"Não consegui conectar à lâmpada no IP {host}: {detail}." + (f" Detalhe: {why}" if why else "")})
                    return
                if errors:
                    raise errors[0]
                emit({"ok": False, "error": "Nenhuma Tapo foi encontrada. Confira se a lâmpada está ligada e na mesma rede Wi-Fi do computador ou informe o IP dela."})
                return
            device = lights[0]
        else:
            opened.append(device)

        if not is_light(device) and "L5" not in str(device.model or "").upper():
            emit({"ok": False, "error": f"O dispositivo {device.model or 'desconhecido'} não é uma lâmpada Tapo compatível."})
            return

        await device.update()
        light = device.modules.get(Module.Light)
        if action == "on":
            await device.turn_on()
        elif action == "off":
            await device.turn_off()
        elif action == "brightness":
            if not light or not has_light_feature(light, "brightness"):
                raise RuntimeError("Este dispositivo não disponibiliza controle de brilho.")
            await device.turn_on()
            await light.set_brightness(int(args["brightness"]))
        elif action == "temperature":
            if not light or not has_light_feature(light, "color_temp"):
                raise RuntimeError("Este dispositivo não disponibiliza temperatura de cor.")
            await device.turn_on()
            await light.set_color_temp(int(args["colorTemp"]))
        elif action == "color":
            if not light or not has_light_feature(light, "hsv"):
                raise RuntimeError("Este dispositivo não disponibiliza controle de cor HSV.")
            await device.turn_on()
            await light.set_hsv(int(args["hue"]), int(args["saturation"]), int(args["brightness"]))
        elif action == "effect":
            effect_module = device.modules.get(Module.LightEffect)
            if not effect_module:
                raise RuntimeError("O firmware desta L530E não expõe efeitos de iluminação pelo controle local.")
            available = [str(item) for item in (effect_module.effect_list or [])]
            requested = str(args.get("effect") or "Off").strip().lower()
            match = next((item for item in available if item.lower() == requested), None)
            if not match:
                raise RuntimeError("Efeito não disponível neste firmware. Efeitos encontrados: " + (", ".join(available) or "nenhum"))
            if match.lower() != "off":
                await device.turn_on()
            kwargs = {}
            if args.get("brightness") is not None:
                kwargs["brightness"] = max(1, min(100, int(args["brightness"])))
            await effect_module.set_effect(match, **kwargs)
        elif action == "preset":
            feature = device.features.get("light_preset")
            if not feature:
                raise RuntimeError("Este firmware não disponibiliza os presets pelo controle local.")
            choices = [str(item) for item in (feature.choices or [])]
            requested = f"Light preset {int(args['preset'])}"
            match = next((item for item in choices if item.lower() == requested.lower()), None)
            if not match:
                raise RuntimeError("Esse preset não está disponível. Opções encontradas: " + (", ".join(choices) or "nenhuma"))
            await feature.set_value(match)
        elif action in ("transition-on", "transition-off"):
            feature_name = "smooth_transition_on" if action == "transition-on" else "smooth_transition_off"
            feature = device.features.get(feature_name)
            if not feature:
                raise RuntimeError("Este firmware não disponibiliza transição suave configurável.")
            await feature.set_value(max(0, min(60, int(args["seconds"]))))
        elif action == "auto-white":
            feature = None
            for key, candidate in device.features.items():
                if "auto" in str(key).lower() and "white" in str(key).lower():
                    feature = candidate
                    break
            if not feature:
                raise RuntimeError("O branco automático está disponível no aplicativo Tapo, mas o firmware/API local desta lâmpada não expõe esse ajuste ao Yoru. Ative Auto Match ou Auto Compensate no aplicativo Tapo.")
            choices = [str(item) for item in (feature.choices or [])]
            wanted = "match" if args.get("mode") == "match" else "compensate"
            match = next((item for item in choices if wanted in item.lower()), None)
            if not match:
                raise RuntimeError("O dispositivo não informou uma opção compatível de branco automático.")
            await feature.set_value(match)
        elif action == "scene":
            if not light:
                raise RuntimeError("O módulo de iluminação não está disponível.")
            scenes = {
                "relax": {"kind": "temperature", "brightness": 42, "temperature": 2700},
                "focus": {"kind": "temperature", "brightness": 100, "temperature": 5000},
                "night": {"kind": "temperature", "brightness": 10, "temperature": 2500},
                "warm": {"kind": "temperature", "brightness": 65, "temperature": 2700},
                "daylight": {"kind": "temperature", "brightness": 100, "temperature": 6500},
                "reading": {"kind": "temperature", "brightness": 82, "temperature": 4300},
                "movie": {"kind": "temperature", "brightness": 24, "temperature": 2700},
                "romantic": {"kind": "temperature", "brightness": 32, "temperature": 2500},
                "gaming": {"kind": "color", "brightness": 65, "hue": 238, "saturation": 92},
                "party": {"kind": "color", "brightness": 100, "hue": __import__("secrets").randbelow(360), "saturation": 100},
                "morning": {"kind": "temperature", "brightness": 78, "temperature": 5000},
            }
            scene = str(args.get("scene") or "").lower()
            if scene not in scenes:
                raise RuntimeError("Cena não reconhecida.")
            preset = scenes[scene]
            await device.turn_on()
            if scene in ("party", "relax"):
                effect_module = device.modules.get(Module.LightEffect)
                target_effect = "Party" if scene == "party" else "Relax"
                available = [str(item) for item in (effect_module.effect_list or [])] if effect_module else []
                native_effect = next((item for item in available if item.lower() == target_effect.lower()), None)
                if native_effect:
                    await effect_module.set_effect(native_effect, brightness=preset["brightness"])
                    await device.update()
                    emit(serialise(device))
                    return
            if preset["kind"] == "color":
                if not has_light_feature(light, "hsv"):
                    raise RuntimeError("Esta lâmpada não disponibiliza controle de cor HSV.")
                await light.set_hsv(preset["hue"], preset["saturation"], preset["brightness"])
            else:
                if has_light_feature(light, "brightness"):
                    await light.set_brightness(preset["brightness"])
                if has_light_feature(light, "color_temp"):
                    await light.set_color_temp(preset["temperature"])
        elif action != "state":
            raise RuntimeError("Ação não permitida.")

        await device.update()
        emit(serialise(device))
    except Exception as exc:
        emit({"ok": False, "error": friendly_error(exc)})
    finally:
        for dev in opened:
            try:
                await dev.disconnect()
            except Exception:
                pass


# Erros que NÃO adianta repetir (senha errada, falta de biblioteca, ação inválida...).
_FATAL_HINTS = (
    "recusou o e-mail", "configure o e-mail", "não está instalada", "não instalada",
    "não é suportado", "ainda não é suportado", "não é uma lâmpada", "ação não permitida",
    "não disponibiliza", "entrada inválida",
)
RETRY_DELAY_S = 3
RETRY_MAX_ATTEMPTS = 4


def _is_fatal(result):
    if not isinstance(result, dict) or result.get("ok") is not False:
        return True  # sucesso (ou formato desconhecido): não repete
    if result.get("needsInstall") or result.get("needsPython"):
        return True
    text = str(result.get("error") or "").lower()
    return any(h in text for h in _FATAL_HINTS)


async def main_forever(payload):
    """Repete descoberta vazia algumas vezes, mas nunca deixa o processo preso indefinidamente."""
    global emit
    real_emit = emit
    attempts = 0
    while True:
        attempts += 1
        captured = []
        emit = lambda value: captured.append(value)
        try:
            await main(payload)
        finally:
            emit = real_emit
        result = captured[-1] if captured else {"ok": False, "error": "Sem resposta do conector."}
        if _is_fatal(result) and not result.get("retryable"):
            real_emit(result)
            return
        if attempts >= RETRY_MAX_ATTEMPTS:
            if payload.get("action") == "discover" and result.get("retryable"):
                result = {**result, "ok": True, "items": [], "retryable": False,
                          "message": "Não encontrei lâmpadas após quatro tentativas. Confira o IP, o Wi-Fi e o Firewall do Windows."}
            real_emit(result)
            return
        await asyncio.sleep(RETRY_DELAY_S)

if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("Entrada inválida")
        asyncio.run(main_forever(payload))
    except Exception as exc:
        emit({"ok": False, "error": str(exc)[:400] or "Falha no conector Tapo."})
