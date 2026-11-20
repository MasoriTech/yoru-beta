# Backend opcional Faster-Whisper (CTranslate2). Protocolo JSONL: prepare/transcribe.
import sys, json, os, base64, traceback, time, re, shutil

try:
    import numpy as np
    from faster_whisper import WhisperModel
except Exception as exc:
    print(json.dumps({'type':'fatal','message':str(exc)}), flush=True)
    sys.exit(2)

cache_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser('~'), '.cache', 'yoru', 'whisper')
threads = max(1, min(16, int(sys.argv[2]) if len(sys.argv) > 2 else 2))
model = None
model_name = None

NET_RE = re.compile(r'connect|timeout|timed out|network|resolve|max retries|ssl|reset|offline|http|temporar|unreachable', re.I)
CORRUPT_RE = re.compile(r'unable to open|model\.bin|corrupt|invalid|truncated|incomplete|unexpected end', re.I)

def load_model(name, attempts=3):
    """Carrega/baixa o modelo com novas tentativas (rede instável) e limpa o cache se o arquivo estiver corrompido."""
    purged = False
    for attempt in range(1, attempts + 1):
        try:
            return WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=threads, num_workers=1, download_root=cache_dir)
        except Exception as exc:
            text = str(exc)
            corrupt = bool(CORRUPT_RE.search(text)) and not purged
            if attempt >= attempts or not (corrupt or NET_RE.search(text)):
                raise
            if corrupt and re.fullmatch(r'[A-Za-z0-9._-]+', name):
                purged = True
                shutil.rmtree(os.path.join(cache_dir, 'models--Systran--faster-whisper-' + name), ignore_errors=True)
            else:
                time.sleep(2 * attempt * attempt)

def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

for line in sys.stdin:
    try:
        msg = json.loads(line)
        mid = msg.get('id')
        typ = msg.get('type')
        if typ == 'prepare':
            name = msg.get('model', 'base')
            if name != model_name:
                model = load_model(name)
                model_name = name
            emit({'type':'ready','id':mid,'model':model_name,'device':'cpu','backend':'faster-whisper'})
        elif typ == 'transcribe':
            if model is None:
                raise RuntimeError('O modelo Faster-Whisper ainda não foi preparado.')
            raw = base64.b64decode(msg.get('audio',''))
            audio = np.frombuffer(raw, dtype=np.float32)
            if audio.size < 3200:
                emit({'type':'result','id':mid,'text':''}); continue
            segments, info = model.transcribe(audio, language='pt', task='transcribe', beam_size=1,
                best_of=1, temperature=0.0, condition_on_previous_text=False,
                vad_filter=True, vad_parameters={'min_silence_duration_ms':350, 'speech_pad_ms':250},
                without_timestamps=True)
            text = ' '.join((s.text or '').strip() for s in segments).strip()
            emit({'type':'result','id':mid,'text':text,'backend':'faster-whisper','language':getattr(info,'language','pt')})
    except Exception as exc:
        emit({'type':'error','id':mid if 'mid' in locals() else None,'message':str(exc),'trace':traceback.format_exc(limit=1)})
