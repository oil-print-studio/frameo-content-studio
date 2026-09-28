# FRAME O 릴스·틱톡 시제 광고: 고양이 카페 유화 (10초)

- **상태:** 방향 승인 완료. 장면 1·2는 로컬 편집으로 제작 완료, 장면 3은 Runway 생성 전 최종 승인 대기
- **포맷:** 세로 9:16 (1080×1920 편집 / Runway 720:1280 생성), 10초, 24fps
- **핵심 메시지:** 평범한 반려동물 사진 한 장이 세상에 하나뿐인 공간과 유화 작품으로 완성된다.
- **입력 소스:** `IMG1` 원본 고양이 사진, `IMG2` 고양이 카페 배경 유화 완성작 (크롭 결과물은 저장소에 커밋하지 않음)

## 0. 소스 분석과 크롭 (크레딧 없이 로컬에서 완료)

**소스 분석**
- IMG1 원본: 1080×810 가로 사진. 스코티시 폴드 계열 브라운 태비. 접힌 귀, 노란빛 초록 눈, 분홍 코, 배와 다리에 주황빛 털. 흰 수건 위에 엎드려 몸을 오른쪽으로 길게 뻗은 자세.
- IMG2 완성작: 1344×1792 세로(3:4). 원본을 약 1.29배 키우고 위쪽에 카페 공간을 더한 구도. 눈 기준 변환은 `painting = photo × 1.29 + (-6, 569)`.
- Meta AI 워터마크: IMG2 오른쪽 아래, 약 x 1000–1325 / y 1645–1720.

**핵심 제약:** 원본은 가로 사진이라 유화의 아래쪽 약 2/3만 겹칩니다. 원본과 유화를 같은 넓은 9:16 구도로 맞출 수 없습니다.
→ 장면 1·2는 **타이트 구도(얼굴과 앞발)**로 정렬하고, 장면 3에서 **넓은 구도로 컷 전환해 카페 공간을 공개**합니다. 각 장면 안에서 카메라는 계속 전진만 합니다.

| 파일 (720×1280) | 용도 | 원본 크롭 좌표 (x1,y1,x2,y2) |
| --- | --- | --- |
| `S1_S2first_photo_916.png` | 장면 1 입력, 장면 2 첫 프레임 | IMG1 (95, 0, 551, 810) |
| `S2last_painting_tight_916.png` | 장면 2 끝 프레임 | IMG2 (117, 569, 705, 1614), 눈 위치 정렬 |
| `S3_painting_wide_916.png` | 장면 3 입력 | IMG2 (40, 0, 940, 1600), 워터마크 영역 완전 제외 |

- 넓은 크롭은 y 1600에서 잘라 워터마크(y 1645~)와 아래쪽 선반 잡동사니를 함께 뺐습니다. 이미지에 워터마크가 아예 없으므로 영상에 나타날 수 없습니다.
- 원본 크롭은 456×810에서 1.58배 확대한 것이라 약간 부드럽습니다. "평범한 사진" 느낌이라 오히려 대비에 도움이 됩니다.

## 1. 스토리보드

| 장면 | 시간 | 화면 | 카메라 | 허용되는 움직임 | 입력 |
| --- | --- | --- | --- | --- | --- |
| 1. 원본 사진 소개 | 0:00–0:02 | 집 안 흰 수건 위에 엎드린 고양이. 얼굴과 앞발 중심, 있는 그대로의 스냅 사진 톤 | 아주 느린 전진 (약 3~5%) | 눈 한 번 깜빡임, 미세한 호흡 | S1_S2first_photo_916 |
| 2. 사진 → 유화 전환 | 0:02–0:05 | 붓 터치가 가장자리에서 중심으로 번지며 털과 수건이 유화로 바뀜. 배경이 따뜻한 나무 카운터로 녹아듦 | 전진 계속 | 고양이 정지, 물감 질감만 생김 | 첫 S1_S2first → 끝 S2last_painting_tight |
| 3. 완성작 공개 | 0:05–0:10 | **컷 전환(음악 비트)** 후 넓은 구도. 선반, 크루아상 돔, 식물, 줄조명이 있는 카페 유화 전체 | 얼굴 쪽으로 매우 느린 전진 (약 6~8%, 얼굴은 화면 가로 41%·세로 49% 지점) | 깜빡임·호흡, 줄조명과 창빛만 은은하게 반짝임 | S3_painting_wide_916 |

**감정 흐름:** 익숙함(우리 집 아이) → 기대(변화) → 감탄(작품과 공간).
**음악 제안(편집 단계):** 잔잔한 피아노나 어쿠스틱. 0:02에 부드러운 스웰, 0:05 컷에 맞춰 코드가 풀리게 한다.
**텍스트·로고:** 영상 생성물에는 넣지 않는다. 필요하면 편집 툴에서 별도 레이어로 얹는다.

## 2. Runway 프롬프트 (영문)

작성 원칙:
- 이미지 투 비디오에서는 **고양이 외형을 묘사하지 않는다.** 외형은 입력 이미지가 결정하고, 텍스트로 묘사하면 오히려 얼굴이나 무늬가 바뀔 수 있다. 프롬프트에는 움직임, 카메라, 빛, 질감만 적는다.
- **부정문을 쓰지 않는다** ("no text", "no new cats" 등). Runway 공식 가이드상 부정 프롬프트는 반대 결과를 낼 수 있어 긍정 표현으로 제약한다.
- 장면 3 선반의 **고양이 인형**이 살아 움직이는 것이 가장 큰 위험이라, 인형이 정지해 있다고 명시한다.

### 장면 1: 원본 사진 소개 (2초)

```
Slow, smooth dolly-in toward the cat's face. The cat stays lying down on the towel, perfectly still, keeping its original pose and gaze, with one soft natural blink and gentle, subtle breathing. Natural, true-to-life home snapshot look with soft indoor light. Calm, intimate mood. Locked composition, steady camera.
```

### 장면 2: 사진에서 유화로 (3초)

```
Continuous slow dolly-in. The photograph gradually transforms into a hand-painted oil painting: rich impasto brushstrokes sweep inward from the edges toward the center, thick oil paint texture forming over the fur and the white towel. The cat stays perfectly still, keeping exactly the same pose, face, eyes, folded ears and fur pattern. The background softly dissolves into warm wooden café furniture. Warm golden light, elegant painterly transformation, fine art.
```

### 장면 3: 고양이 카페 유화 완성작 공개 (5초)

```
Very slow, steady dolly-in toward the cat's face in the oil painting. The cat remains lying down and completely still, with only a subtle blink and gentle breathing. The canvas surface is richly textured, with thick impasto brushstrokes and visible paint ridges catching the warm light. The string of fairy lights at the top twinkles softly and the window light glows gently. The figurines, plants, pastries and furniture stay perfectly still. Cozy, warm, premium gallery atmosphere, fine art oil painting.
```

## 3. 생성 설정 (권장)

| 항목 | 장면 1 | 장면 2 | 장면 3 |
| --- | --- | --- | --- |
| 모드 | Image to Video | First + Last frame (키프레임 지원 모델) | Image to Video |
| 비율 | 720:1280 (9:16) | 720:1280 | 720:1280 |
| 생성 길이 | 5초 → 앞 2초 사용 | 5초 → 3초 구간 사용 | 5초 그대로 사용 |
| 카메라 | Zoom in, 최소 강도 (카메라 컨트롤 지원 시) | 동일 | 동일 |
| 시드 | 고정 (세 장면 같은 시드로 시작) | 고정 | 고정 |
| 1차 생성 수 | 1회 | 1회 | 1회 |

- 짧은 장면은 **속도를 올리지 말고 잘라서** 쓴다. 속도를 올리면 깜빡임·호흡이 빨라져 부자연스러워진다.
- 0:02 경계는 6~8프레임 크로스페이드로 잇는다(같은 구도라 연속 푸시처럼 보인다). 0:05는 음악 비트에 맞춘 하드 컷으로 공개감을 준다.

### 크레딧 절약안 (선택)

- **장면 1**은 IMG1_916에 편집 툴 줌(켄 번즈)만 적용해도 된다. 크레딧이 들지 않고 고양이가 100% 동일하게 유지된다. 대신 깜빡임이 없다.
- **장면 2**는 편집 툴에서 IMG1 → IMG2 브러시 마스크 리빌(붓 모양 마스크로 닦아내듯 전환)로도 만들 수 있다. 형태 보존은 가장 확실하지만, AI 생성 특유의 "물감이 맺히는" 느낌은 약해진다.
- 이렇게 하면 Runway 생성은 **장면 3 한 번만** 필요하다.

## 4. 검수 체크리스트

- [ ] 고양이 얼굴, 눈 색, 귀 모양, 털무늬, 체형이 원본과 같다
- [ ] 고양이가 걷거나 고개를 돌리지 않는다 (깜빡임·호흡만 있다)
- [ ] 새 고양이, 사람, 물체가 나타나지 않는다
- [ ] 선반의 고양이 인형이 움직이거나 진짜 고양이로 바뀌지 않는다
- [ ] 접힌 귀가 펴지지 않는다
- [ ] 화면 안에 글자, 로고, 워터마크 형태가 생기지 않는다
- [ ] 하단에 Meta AI 워터마크가 한 프레임도 보이지 않는다
- [ ] 배경에서는 조명만 반짝이고 나머지는 정지해 있다
- [ ] 유화 질감(임파스토, 붓 자국)이 장면 3 전체에서 선명하다

## 5. 1차 시제품 확정안 (승인 반영)

- 장면 1: 편집 줌(1.00→1.03배, 2초). 장면 2: 붓 모양 마스크 전환(가장자리 → 얼굴 순, 줌 1.03→1.08배, 3초). 둘 다 로컬에서 제작, 크레딧 0.
- 장면 3만 Runway Gen-4 Turbo로 생성: 이미지 투 비디오, 720:1280, 5초, 결과 1개, 업스케일·추가 생성 없음.
- **수정:** 완성된 유화 작품을 보여주는 것이 목적이므로 눈 깜빡임과 호흡은 뺀다. 카메라 전진과 조명 반짝임만 허용한다.
- 예상 크레딧: Gen-4 Turbo 초당 5크레딧 × 5초 = 25크레딧 (무료 계정 기본 125크레딧 중).
- 무료 플랜 제약: 결과물 오른쪽 아래에 Runway 워터마크가 들어간다(내부 검토용). Gen-4.5는 무료 플랜에서 쓸 수 없어 최종본에는 유료 플랜이 필요하다.

### 장면 3 최종 프롬프트 (Gen-4 Turbo)

```
Very slow, steady dolly-in toward the cat's face. This is a finished oil painting on canvas: the painted cat is a completely static artwork, with its face, eyes, folded ears, fur pattern and pose fixed exactly in place. Thick impasto brushstrokes and raised paint ridges catch the warm light as the camera glides closer. The string of fairy lights at the top twinkles softly and the warm window light glows gently. The figurines, plants, pastries and furniture remain perfectly still. Cozy, warm, premium gallery atmosphere.
```
