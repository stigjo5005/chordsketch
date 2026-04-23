import json
import os
import tempfile
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import torch
import torchaudio
from yt_dlp import YoutubeDL


ROOT = Path(__file__).resolve().parent
DOWNLOADS_DIR = ROOT / "downloads"
DOWNLOADS_DIR.mkdir(exist_ok=True)

OPENAI_API_URL = "https://api.openai.com/v1/responses"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")


class ChordSketchHTTPServer(ThreadingHTTPServer):
    daemon_threads = True


class ChordSketchHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        if self.path.endswith((".html", ".js", ".css")) or self.path == "/":
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            self.respond_json(
                {
                    "ok": True,
                    "service": "ChordSketch",
                    "openai_enabled": bool(os.getenv("OPENAI_API_KEY")),
                }
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/youtube-download":
            self.handle_youtube_download()
            return
        if self.path.startswith("/api/audio-analyze"):
            self.handle_audio_analyze()
            return
        if self.path.startswith("/api/youtube-analyze"):
            self.handle_youtube_analyze()
            return
        if self.path == "/api/ai-refine":
            self.handle_ai_refine()
            return

        self.send_error(404, "Unknown API endpoint")

    def handle_youtube_download(self) -> None:
        try:
            payload = self.read_json_body()
            url = payload.get("url", "").strip()
            if not url:
                self.respond_json({"error": "유튜브 링크가 필요합니다."}, status=400)
                return

            result = download_youtube_audio(url)
            self.respond_json(result)
        except Exception as error:
            self.respond_json(
                {
                    "error": (
                        "유튜브 다운로드에 실패했습니다. "
                        "영상 자체 제한이 있거나 Render 환경에서 접근이 막힌 경우일 수 있습니다. "
                        f"상세: {error}"
                    )
                },
                status=500,
            )

    def handle_audio_analyze(self) -> None:
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            title = (params.get("title") or ["audio-file"])[0]
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                self.respond_json({"error": "분석할 오디오 데이터가 없습니다."}, status=400)
                return

            audio_bytes = self.rfile.read(content_length)
            analysis = analyze_audio_bytes(audio_bytes, title)
            self.respond_json(analysis)
        except Exception as error:
            self.respond_json({"error": f"서버 오디오 분석에 실패했습니다: {error}"}, status=500)

    def handle_youtube_analyze(self) -> None:
        try:
            payload = self.read_json_body()
            url = payload.get("url", "").strip()
            if not url:
                self.respond_json({"error": "유튜브 링크가 필요합니다."}, status=400)
                return

            download = download_youtube_audio(url)
            file_path = ROOT / download["audioPath"].lstrip("/")
            analysis = analyze_audio_file(file_path, download["title"])
            analysis["sourceUrl"] = url
            self.respond_json(analysis)
        except Exception as error:
            self.respond_json({"error": f"유튜브 분석에 실패했습니다: {error}"}, status=500)

    def handle_ai_refine(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            self.respond_json(
                {"error": "OPENAI_API_KEY가 설정되지 않아 AI 보정을 사용할 수 없습니다."},
                status=400,
            )
            return

        try:
            payload = self.read_json_body()
            result = refine_with_openai(payload, api_key)
            self.respond_json(result)
        except Exception as error:
            self.respond_json({"error": f"AI 보정에 실패했습니다: {error}"}, status=500)

    def read_json_body(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        return json.loads(raw or b"{}")

    def respond_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def download_youtube_audio(url: str) -> dict:
    fallback_runs = [
        {
            "extractor_args": {"youtube": {"player_client": ["android", "tv", "web"]}},
            "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
        },
        {
            "extractor_args": {"youtube": {"player_client": ["tv", "web"]}},
            "format": "bestaudio[protocol!=m3u8]/bestaudio/best",
        },
        {
            "extractor_args": {"youtube": {"player_client": ["ios", "web"]}},
            "format": "bestaudio/best",
        },
    ]

    errors: list[str] = []
    info = None
    file_path = None

    for fallback in fallback_runs:
        options = {
            "extractor_args": fallback["extractor_args"],
            "format": fallback["format"],
            "outtmpl": str(DOWNLOADS_DIR / "%(id)s.%(ext)s"),
            "noplaylist": True,
            "proxy": "",
            "quiet": True,
            "restrictfilenames": True,
            "overwrites": False,
            "retries": 2,
            "socket_timeout": 30,
        }

        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(url, download=True)
                requested = info.get("requested_downloads") or []
                if requested and requested[0].get("filepath"):
                    file_path = Path(requested[0]["filepath"])
                else:
                    file_path = Path(ydl.prepare_filename(info))
            break
        except Exception as error:
            errors.append(str(error))

    if info is None or file_path is None:
        joined = " | ".join(errors[-3:])
        raise RuntimeError(
            "유튜브 오디오를 가져오지 못했습니다. 일부 영상은 유튜브 제한 때문에 직접 다운로드가 막힐 수 있습니다. "
            f"마지막 오류: {joined}"
        )

    relative_path = file_path.relative_to(ROOT).as_posix()
    return {
        "title": info.get("title") or file_path.stem,
        "audioPath": f"/{relative_path}",
        "sourceUrl": url,
    }


def analyze_audio_bytes(audio_bytes: bytes, title: str) -> dict:
    suffix = Path(title).suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(audio_bytes)
        temp_path = Path(temp.name)

    try:
        return analyze_audio_file(temp_path, title)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass


def analyze_audio_file(file_path: Path, title: str) -> dict:
    waveform, sample_rate = torchaudio.load(str(file_path))
    if waveform.ndim > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    max_seconds = 90
    max_samples = min(waveform.shape[-1], sample_rate * max_seconds)
    waveform = waveform[:, :max_samples]
    mono = waveform.squeeze(0)

    bpm = estimate_tempo_backend(mono, sample_rate)
    notes = extract_notes_backend(mono, sample_rate)
    key = estimate_key_backend(notes)
    duration_seconds = round(float(mono.shape[-1] / sample_rate), 2)
    chords = estimate_chords_backend(mono, sample_rate, bpm, key)
    sections = detect_sections_backend(chords, duration_seconds)

    return {
        "title": title,
        "durationSeconds": duration_seconds,
        "bpm": int(round(bpm)),
        "key": key,
        "notes": notes,
        "chords": chords,
        "sections": sections,
        "wasTrimmed": waveform.shape[-1] < sample_rate * max_seconds,
        "analysisSource": "backend",
    }


def estimate_tempo_backend(mono: torch.Tensor, sample_rate: int) -> float:
    frame = 1024
    hop = 512
    if mono.numel() < frame * 2:
        return 120.0

    windows = mono.unfold(0, frame, hop)
    energy = torch.sqrt((windows**2).mean(dim=1) + 1e-8)
    flux = torch.clamp(energy[1:] - energy[:-1], min=0)
    if flux.numel() == 0:
        return 120.0

    best_bpm = 120
    best_score = -1.0
    for bpm in range(70, 181):
        lag = max(1, round((60 / bpm) * sample_rate / hop))
        if lag >= flux.numel():
            continue
        score = torch.dot(flux[lag:], flux[:-lag]).item()
        if score > best_score:
            best_score = score
            best_bpm = bpm
    return float(best_bpm)


def extract_notes_backend(mono: torch.Tensor, sample_rate: int) -> list[dict]:
    frame_time = 0.02
    win_length = int(sample_rate * frame_time)
    if mono.numel() < win_length:
        return []

    pitch = torchaudio.functional.detect_pitch_frequency(
        mono.unsqueeze(0),
        sample_rate=sample_rate,
        frame_time=frame_time,
        freq_low=82,
        freq_high=880,
    ).squeeze(0)

    energies = mono.unfold(0, win_length, win_length).pow(2).mean(dim=1).sqrt()
    length = min(pitch.numel(), energies.numel())
    pitch = pitch[:length]
    energies = energies[:length]

    events: list[dict] = []
    step = frame_time
    for index in range(length):
        frequency = float(pitch[index].item())
        energy = float(energies[index].item())
        time = round(index * step, 3)
        if not np.isfinite(frequency) or frequency < 82 or frequency > 880 or energy < 0.018:
            continue

        midi = int(round(69 + 12 * np.log2(frequency / 440.0)))
        previous = events[-1] if events else None
        if previous and abs(previous["midi"] - midi) <= 1 and time - previous["end"] <= 0.05:
            previous["end"] = round(time + step, 3)
            previous["frequency_sum"] += frequency
            previous["count"] += 1
        else:
            events.append(
                {
                    "midi": midi,
                    "start": time,
                    "end": round(time + step, 3),
                    "frequency_sum": frequency,
                    "count": 1,
                }
            )

    cleaned: list[dict] = []
    for event in events:
        duration = round(event["end"] - event["start"], 3)
        if duration < 0.18:
            continue
        frequency = event["frequency_sum"] / event["count"]
        note_name = midi_to_note_name(event["midi"])
        cleaned.append(
            {
                "note": note_name,
                "midi": int(event["midi"]),
                "start": round(event["start"], 2),
                "end": round(event["end"], 2),
                "duration": round(duration, 2),
                "frequency": round(frequency, 1),
            }
        )

    return simplify_notes_backend(cleaned)[:48]


def simplify_notes_backend(notes: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for note in notes:
        previous = merged[-1] if merged else None
        if (
            previous
            and abs(previous["midi"] - note["midi"]) <= 1
            and note["start"] - previous["end"] <= 0.12
        ):
            previous["end"] = note["end"]
            previous["duration"] = round(previous["end"] - previous["start"], 2)
            previous["midi"] = int(round((previous["midi"] + note["midi"]) / 2))
            previous["frequency"] = round((previous["frequency"] + note["frequency"]) / 2, 1)
            previous["note"] = midi_to_note_name(previous["midi"])
        else:
            merged.append(dict(note))

    result: list[dict] = []
    for idx, note in enumerate(merged):
        previous = merged[idx - 1] if idx > 0 else None
        next_note = merged[idx + 1] if idx + 1 < len(merged) else None
        is_blip = note["duration"] <= 0.22
        is_outlier = (
            previous
            and next_note
            and abs(note["midi"] - previous["midi"]) >= 5
            and abs(note["midi"] - next_note["midi"]) >= 5
        )
        if is_blip and is_outlier:
            continue
        result.append(note)
    return result


def estimate_key_backend(notes: list[dict]) -> str:
    if not notes:
        return "Unknown"

    weights = np.zeros(12, dtype=np.float32)
    for note in notes:
        weights[note["midi"] % 12] += max(0.1, note["duration"])

    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    best_score = -1.0
    best_label = "Unknown"
    for tonic in range(12):
        major_score = float(np.dot(weights, np.roll(major, tonic)))
        minor_score = float(np.dot(weights, np.roll(minor, tonic)))
        if major_score > best_score:
            best_score = major_score
            best_label = f"{NOTE_NAMES[tonic]} Major"
        if minor_score > best_score:
            best_score = minor_score
            best_label = f"{NOTE_NAMES[tonic]} Minor"
    return best_label


def estimate_chords_backend(mono: torch.Tensor, sample_rate: int, bpm: float, key_label: str) -> list[dict]:
    beat_duration = 60.0 / max(60.0, bpm)
    segment_seconds = max(beat_duration * 4, 2.0)
    segment_samples = max(2048, int(sample_rate * segment_seconds))
    hop_samples = segment_samples

    if mono.numel() < segment_samples:
        return []

    spec = torch.stft(
        mono,
        n_fft=4096,
        hop_length=1024,
        win_length=4096,
        window=torch.hann_window(4096),
        return_complex=True,
    )
    magnitude = spec.abs()
    frequencies = torch.fft.rfftfreq(4096, d=1 / sample_rate)
    key_profile = build_key_profile_backend(key_label)

    segments: list[dict] = []
    previous_chord = ""
    for start_sample in range(0, mono.numel() - segment_samples + 1, hop_samples):
        end_sample = min(start_sample + segment_samples, mono.numel())
        frame_start = start_sample // 1024
        frame_end = max(frame_start + 1, end_sample // 1024)
        chroma = np.zeros(12, dtype=np.float32)

        for bin_index, frequency in enumerate(frequencies):
            freq = float(frequency.item())
            if freq < 82 or freq > 1200:
                continue
            midi = int(round(69 + 12 * np.log2(freq / 440.0)))
            pitch_class = midi % 12
            energy = float(magnitude[bin_index, frame_start:frame_end].mean().item())
            chroma[pitch_class] += energy

        chord = best_chord_for_chroma(chroma, key_profile, previous_chord)
        segment = {
            "start": round(start_sample / sample_rate, 2),
            "end": round(end_sample / sample_rate, 2),
            "chord": chord,
        }
        if segments and segments[-1]["chord"] == chord:
            segments[-1]["end"] = segment["end"]
        else:
            segments.append(segment)
        previous_chord = chord

    return simplify_chord_segments_backend(segments, beat_duration)


def build_key_profile_backend(key_label: str) -> set[int]:
    tonic_name, _, mode = key_label.partition(" ")
    if tonic_name not in NOTE_NAMES:
        return set()
    tonic = NOTE_NAMES.index(tonic_name)
    scale = [0, 2, 3, 5, 7, 8, 10] if mode == "Minor" else [0, 2, 4, 5, 7, 9, 11]
    return {(tonic + interval) % 12 for interval in scale}


def best_chord_for_chroma(chroma: np.ndarray, key_profile: set[int], previous_chord: str) -> str:
    best_score = -1e9
    best_name = "N.C."
    for root in range(12):
        for suffix, intervals in [
            ("", [0, 4, 7]),
            ("m", [0, 3, 7]),
            ("7", [0, 4, 7, 10]),
            ("maj7", [0, 4, 7, 11]),
            ("m7", [0, 3, 7, 10]),
        ]:
            hit = 0.0
            miss = 0.0
            diatonic = 0.0
            for pitch in range(12):
                interval = (pitch - root) % 12
                if interval in intervals:
                    hit += chroma[pitch] * 1.35
                    if pitch in key_profile:
                        diatonic += 0.12
                else:
                    miss += chroma[pitch] * 0.42

            score = hit - miss + diatonic
            if suffix in {"7", "maj7", "m7"}:
                score -= 0.18
            name = f"{NOTE_NAMES[root]}{suffix}"
            if name == previous_chord:
                score += 0.5
            if score > best_score:
                best_score = score
                best_name = name
    return best_name


def simplify_chord_segments_backend(segments: list[dict], beat_duration: float) -> list[dict]:
    minimum_span = max(beat_duration * 4, 2.2)
    simplified: list[dict] = []
    for segment in segments:
        span = segment["end"] - segment["start"]
        previous = simplified[-1] if simplified else None
        if previous and (segment["chord"] == previous["chord"] or span < minimum_span):
            previous["end"] = segment["end"]
        else:
            simplified.append(dict(segment))
    return simplified


def detect_sections_backend(chords: list[dict], duration_seconds: float) -> list[dict]:
    if not chords:
        return []

    window = max(6.0, min(12.0, duration_seconds / 6 if duration_seconds else 8.0))
    raw: list[dict] = []
    current = 0.0
    while current < duration_seconds:
        end = min(current + window, duration_seconds)
        active = [segment["chord"] for segment in chords if segment["end"] > current and segment["start"] < end]
        if active:
            raw.append(
                {
                    "start": round(current, 2),
                    "end": round(end, 2),
                    "signature": "-".join(active[:4]),
                    "chords": list(dict.fromkeys(active)),
                }
            )
        current = end

    labels: dict[str, str] = {}
    next_label = 0
    sections: list[dict] = []
    for section in raw:
        signature = section["signature"]
        if signature not in labels:
            labels[signature] = chr(65 + next_label)
            next_label += 1
        label = labels[signature]
        summary = "반복 진행" if section["chords"] else "구간"
        sections.append(
            {
                "label": label,
                "start": section["start"],
                "end": section["end"],
                "summary": summary,
                "chords": section["chords"],
            }
        )
    return sections


def midi_to_note_name(midi: int) -> str:
    octave = midi // 12 - 1
    return f"{NOTE_NAMES[midi % 12]}{octave}"


def refine_with_openai(analysis: dict, api_key: str) -> dict:
    prompt = {
        "title": analysis.get("title"),
        "estimated_key": analysis.get("key"),
        "estimated_bpm": analysis.get("bpm"),
        "duration_seconds": analysis.get("durationSeconds"),
        "notes": analysis.get("notes", [])[:24],
        "chords": analysis.get("chords", [])[:18],
        "sections": analysis.get("sections", [])[:8],
    }

    body = {
        "model": OPENAI_MODEL,
        "instructions": (
            "You refine lightweight music lead-sheet estimates. "
            "Keep outputs practical, conservative, and musician-friendly. "
            "Do not invent dense theory. Improve chord labels, section names, and playing tips."
        ),
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "다음 음악 분석 초안을 바탕으로 연습용 리드 시트를 더 자연스럽게 정리해 주세요. "
                            "코드는 과장하지 말고, 실제 기타 연습에 도움이 되는 수준으로만 보정하세요.\n\n"
                            f"{json.dumps(prompt, ensure_ascii=False)}"
                        ),
                    }
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "lead_sheet_refinement",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "refined_key": {"type": "string"},
                        "confidence_note": {"type": "string"},
                        "performance_tips": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "refined_chords": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "start": {"type": "number"},
                                    "end": {"type": "number"},
                                    "chord": {"type": "string"},
                                },
                                "required": ["start", "end", "chord"],
                            },
                        },
                        "refined_sections": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "label": {"type": "string"},
                                    "start": {"type": "number"},
                                    "end": {"type": "number"},
                                    "summary": {"type": "string"},
                                    "chords": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                },
                                "required": ["label", "start", "end", "summary", "chords"],
                            },
                        },
                    },
                    "required": [
                        "refined_key",
                        "confidence_note",
                        "performance_tips",
                        "refined_chords",
                        "refined_sections",
                    ],
                },
            }
        },
    }

    request = urllib.request.Request(
        OPENAI_API_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI API 오류: {detail or error.reason}") from error

    text_output = extract_response_text(payload)
    if not text_output:
        raise RuntimeError("OpenAI 응답에서 JSON 텍스트를 찾지 못했습니다.")

    refined = json.loads(text_output)
    refined["model"] = OPENAI_MODEL
    return refined


def extract_response_text(payload: dict) -> str:
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return content.get("text", "")
    return ""


def main() -> None:
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    server = ChordSketchHTTPServer((host, port), ChordSketchHandler)
    print(f"Serving ChordSketch at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
