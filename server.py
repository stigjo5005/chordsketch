import json
import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

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
            self.respond_json({"error": f"다운로드에 실패했습니다: {error}"}, status=500)

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
    options = {
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
        "outtmpl": str(DOWNLOADS_DIR / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "proxy": "",
        "restrictfilenames": True,
        "overwrites": False,
    }

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        requested = info.get("requested_downloads") or []
        if requested and requested[0].get("filepath"):
            file_path = Path(requested[0]["filepath"])
        else:
            file_path = Path(ydl.prepare_filename(info))

    relative_path = file_path.relative_to(ROOT).as_posix()
    return {
        "title": info.get("title") or file_path.stem,
        "audioPath": f"/{relative_path}",
        "sourceUrl": url,
    }


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
