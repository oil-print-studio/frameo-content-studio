# 내 PC에서 쇼츠 제작기 실행하기

대상 브랜치: `claude/gallant-newton-4eikyv`

| 운영체제 | 검증 상태 |
| --- | --- |
| Linux (Ubuntu 24.04) | **검증함**: 설치부터 MP4 저장, 검사까지 실제로 실행 |
| Windows 10/11 | **미검증**: 아래 절차로 설치한 뒤 `pnpm shorts doctor` 결과를 알려 주세요 |
| macOS | **미검증**: 위와 같음 |

## 1. 필요한 프로그램과 운영체제별 의존성

| 구성 | 용도 | Windows | macOS | Linux |
| --- | --- | --- | --- | --- |
| Node.js 22 LTS (20.9 이상) | 앱·작업 처리 | nodejs.org 설치 파일 | `brew install node@22` | `nvm install 22` 또는 배포판 패키지 |
| pnpm | 패키지 설치 | `corepack enable` | 위와 같음 | 위와 같음 |
| Git | 브랜치 받기 | `winget install Git.Git` | Xcode 도구에 포함 | `sudo apt install git` |
| **FFmpeg·ffprobe** (필수, libass·libx264 포함) | 분석·렌더·자막·검사 | `winget install Gyan.FFmpeg` (full 빌드) | `brew install ffmpeg` | `sudo apt install ffmpeg` |
| **한글 글꼴** | 자막·표지 | 설치 필요 없음: `pnpm install` 이 Pretendard 를 프로젝트 안에 내려받음 (`node_modules/pretendard`) | 같음 | 같음 |
| **음성 엔진** (게시용) | 대본 읽기 | Gemini TTS: 인터넷과 API 키 필요, 설치할 프로그램 없음 | 같음 | 같음 |
| espeak-ng (선택, 데모 전용) | 키 없이 흐름 시험 | github.com/espeak-ng/espeak-ng/releases 의 `.msi` | `brew install espeak-ng` | `sudo apt install espeak-ng` |
| Python 3 + vosk (선택, 측정 전용) | 자막 동기화·발음 측정 | python.org | `brew install python` | 기본 포함 |

**운영체제별 주의**
- **FFmpeg 빌드:** 자막을 입히는 `ass` 필터(libass)와 `libx264` 가 꼭 있어야 합니다. Windows는 Gyan의 full 빌드, macOS는 Homebrew 기본 빌드, Ubuntu는 apt 기본 패키지에 포함돼 있습니다.
- **Windows PATH:** FFmpeg·espeak-ng 를 설치한 뒤에는 터미널을 새로 열어야 PATH 가 반영됩니다. espeak-ng 는 PATH 에 없어도 `C:\Program Files\eSpeak NG\espeak-ng.exe` 를 자동으로 찾습니다. 다른 위치에 설치했다면 `.env.local` 에 `FFMPEG_PATH`, `FFPROBE_PATH`, `ESPEAK_PATH` 를 지정하세요.
- **경로 이름:** 프로젝트 폴더 경로에 작은따옴표(`'`)는 피하세요. 한글·공백은 처리하지만 이 경우는 Windows에서 시험하지 못했습니다.
- **글꼴:** 운영체제에 설치하지 않고 프로젝트 안의 파일을 직접 씁니다. 다른 글꼴을 쓰려면 `SHORTS_FONT_DIR` 를 지정하세요.

## 2. 설치

```bash
git clone https://github.com/oil-print-studio/frameo-content-studio.git
cd frameo-content-studio
git checkout claude/gallant-newton-4eikyv
corepack enable
pnpm install
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
```

`.env.local` 에 Gemini 키를 넣습니다. 이 파일은 git 에 올라가지 않습니다.

```
GEMINI_API_KEY=여기에_키
GEMINI_TTS_VOICE=Kore           # 선택: Gemini 목소리 이름
```

키는 Google AI Studio(https://aistudio.google.com/apikey)에서 발급합니다. 키는 서버 쪽에서만 읽고, 브라우저 화면·로그·내보내기 파일에는 들어가지 않습니다.

## 3. 점검과 실행

```bash
pnpm shorts doctor          # Node·FFmpeg(필수 기능)·글꼴·음성 엔진·Gemini 키와 모델 목록 확인
pnpm shorts gemini-check    # 분석·대본·TTS 를 각각 실제로 호출해 성공 여부·모델·토큰 기록
pnpm dev                    # http://localhost:3000/shorts
```

- `doctor` 는 키가 있으면 계정에서 실제로 쓸 수 있는 모델 목록을 받아 설정된 모델 ID(`gemini-3.8-flash`, `gemini-3.8-flash-tts`)가 있는지 확인합니다. 없으면 쓸 수 있는 모델 이름을 보여 주니, `.env.local` 의 `GEMINI_*_MODEL` 에 지정하세요.
- 운영용 실행은 `pnpm build && pnpm start` 입니다.

## 4. 실제 소재로 영상 한 편 만들기

화면(`/shorts`)에서 파일을 올리거나, 상품 정보 파일 하나로 실행합니다.

```bash
pnpm shorts make 내소재폴더/product.json
```

`product.json` 예시는 `scripts/make-video.ts` 맨 위에 있습니다. 파일마다 역할을 지정합니다.
- `before`: 원본 사진
- `after`: 완성 작품
- `canvas`: 캔버스·설치 사진
- `product`: 상품·사용 장면

원본과 완성 작품이 있으면 '원본 → 완성' 전환 장면이 들어갑니다.

## 5. 측정 도구 (선택)

실제 발화 기준 자막 동기화는 FFmpeg만으로 측정합니다. 발음 명료도 측정에는 Vosk 음성 인식이 추가로 필요합니다.

```bash
python3 -m venv .asr && .asr/bin/pip install vosk==0.3.45      # Windows: .asr\Scripts\pip
# Vosk 한국어 모델(vosk-model-small-ko-0.22)을 alphacephei.com/vosk/models 에서 받아 압축 해제
export ASR_PYTHON=.asr/bin/python ASR_VOSK_MODEL=/모델/폴더
pnpm shorts measure <프로젝트id> common     # 저장한 영상 한 편
pnpm shorts sync-bench gemini              # 숫자·영문 포함 50문장 (Gemini 음성)
```

## 6. 인스타·유튜브 앱에서 위치 확인

```bash
pnpm shorts calibrate      # data/shorts/calibration/ 에 눈금 영상·표지·조정 템플릿 생성
```

확인 절차는 [CALIBRATION.md](CALIBRATION.md) 를 보세요.
