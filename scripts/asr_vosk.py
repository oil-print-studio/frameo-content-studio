"""
측정용 한국어 음성 인식(Vosk). 자막 동기화·발음 명료도 검증에만 쓰며 제작 경로에는 쓰지 않는다.

  python scripts/asr_vosk.py <오디오 파일> <모델 폴더>
  → stdout: {"words": [{"w": "...", "start": 0.12, "end": 0.40, "conf": 0.9}, ...]}

필요: pip install vosk==0.3.45, Vosk 한국어 모델 폴더(ASR_VOSK_MODEL), ffmpeg
"""
import json
import subprocess
import sys

from vosk import KaldiRecognizer, Model, SetLogLevel


def main() -> None:
    audio, model_dir = sys.argv[1], sys.argv[2]
    ffmpeg = sys.argv[3] if len(sys.argv) > 3 else "ffmpeg"
    SetLogLevel(-1)
    pcm = subprocess.run(
        [ffmpeg, "-v", "error", "-i", audio, "-ar", "16000", "-ac", "1", "-f", "s16le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    rec = KaldiRecognizer(Model(model_dir), 16000)
    rec.SetWords(True)
    words = []

    def take(res: str) -> None:
        for w in json.loads(res).get("result", []):
            words.append({"w": w["word"], "start": round(w["start"], 3), "end": round(w["end"], 3), "conf": round(w.get("conf", 0), 3)})

    for i in range(0, len(pcm), 8000):
        if rec.AcceptWaveform(pcm[i : i + 8000]):
            take(rec.Result())
    take(rec.FinalResult())
    json.dump({"words": words}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
