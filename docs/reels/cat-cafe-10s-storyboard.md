# FRAME O 릴스·틱톡 시제 광고: 고양이 카페 유화 (10초)

- **상태:** 초안, 승인 대기 중 (Runway 생성 전)
- **포맷:** 세로 9:16 (1080×1920 편집 / Runway 720:1280 생성), 10초, 24fps
- **핵심 메시지:** 평범한 반려동물 사진 한 장이 세상에 하나뿐인 공간과 유화 작품으로 완성된다.
- **입력 소스:** `IMG1` 원본 고양이 사진, `IMG2` 고양이 카페 배경 유화 완성작

## 0. 생성 전 소스 준비 (크레딧 없이 로컬에서)

1. **워터마크 제거 크롭:** IMG2 하단의 Meta AI 워터마크 영역을 여유 있게(워터마크 높이 + 2~3%) 잘라낸다. 이후 9:16으로 중앙 크롭하고, 고양이는 화면 상단 ⅓~중앙에 둔다.
2. **IMG1도 같은 프레이밍으로:** 고양이 눈 위치와 크기가 IMG2 크롭과 겹치게 맞춘다. 장면 2 전환에서 고양이가 흔들리지 않게 하려는 것이다.
3. **하단 20%는 비워둔다:** 릴스·틱톡 UI(캡션, 버튼)가 덮는 영역이고, 카메라가 전진하면서 하단이 자연히 더 잘려 나가 워터마크 재노출도 막아준다.
4. 크롭 결과물: `IMG1_916.png`, `IMG2_916.png` (각각 1080×1920 이상)

## 1. 스토리보드

| 장면 | 시간 | 화면 | 카메라 | 허용되는 움직임 | 입력 |
| --- | --- | --- | --- | --- | --- |
| 1. 원본 사진 소개 | 0:00–0:02 | 평범한 일상 속 고양이 사진. 자연광, 살짝 차분한 톤 | 아주 느린 전진 (약 3~5% 줌) | 눈 한 번 깜빡임, 미세한 호흡 | IMG1_916 |
| 2. 사진 → 유화 전환 | 0:02–0:05 | 붓 터치가 가장자리에서 중심으로 번지며 사진이 유화로 바뀌고, 배경이 고양이 카페로 녹아든다. 고양이 형태·무늬는 그대로 | 느린 전진 유지 (끊김 없이 이어짐) | 고양이 정지, 물감 질감만 형성 | 첫 프레임 IMG1_916 → 끝 프레임 IMG2_916 |
| 3. 완성작 공개 | 0:05–0:10 | 고양이 카페 유화 완성작. 임파스토 질감과 붓 자국이 빛을 받아 도드라진다 | 매우 느린 전진 (약 5~8% 줌) | 미세한 깜빡임·호흡, 배경 조명만 은은하게 반짝임 | IMG2_916 |

**감정 흐름:** 익숙함(내 아이 사진) → 기대(변화) → 감탄(작품, 공간).
**음악 제안(편집 단계):** 잔잔한 피아노나 어쿠스틱. 장면 2 시작점(0:02)에 부드러운 스웰, 장면 3 공개(0:05)에 맞춰 코드가 풀리게 한다.
**텍스트·로고:** 영상 생성물에는 넣지 않는다. 필요하면 편집 툴에서 마지막 프레임 위에 별도 레이어로 얹는다.

## 2. Runway 프롬프트 (영문)

작성 원칙:
- 이미지 투 비디오에서는 **고양이 외형을 묘사하지 않는다.** 외형은 입력 이미지가 결정하고, 텍스트로 묘사하면 오히려 얼굴이나 무늬가 바뀔 수 있다. 프롬프트에는 움직임, 카메라, 빛, 질감만 적는다.
- **부정문을 쓰지 않는다** ("no text", "no new cats" 등). Runway 공식 가이드상 부정 프롬프트는 반대 결과를 낼 수 있어, "stays still", "the scene stays unchanged" 같은 긍정 표현으로 제약한다. 글자·로고·추가 물체는 프롬프트에 아예 등장시키지 않는 것이 가장 안전하다.

### 장면 1: 원본 사진 소개 (2초)

```
Slow, smooth dolly-in toward the cat. The cat stays seated and perfectly still, keeping its original pose and gaze, with one soft natural blink and gentle, subtle breathing. Warm natural window light, shallow depth of field, soft film grain. Calm, intimate, premium mood. Locked composition, steady camera.
```

### 장면 2: 사진에서 유화로 (3초)

```
Continuous slow dolly-in. The photograph gradually transforms into a hand-painted oil painting: rich impasto brushstrokes sweep inward from the edges toward the center, thick oil paint texture forming over the fur and the surroundings. The cat stays perfectly still, keeping exactly the same pose, face, eyes, ears and fur pattern. The background softly dissolves into a warm, cozy cat café interior. Warm golden light, elegant painterly transformation, fine art.
```

### 장면 3: 고양이 카페 유화 완성작 공개 (5초)

```
Very slow, steady dolly-in toward the cat in the oil painting. The cat remains seated and completely still, with only a subtle blink and gentle breathing. The canvas surface is richly textured, with thick impasto brushstrokes and visible paint ridges catching the warm light. In the cat café background, the warm lamps and small lights twinkle softly and gently. Everything else in the scene stays calm and unchanged. Cozy, warm, premium gallery atmosphere, fine art oil painting.
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
- 장면 경계(0:02, 0:05)는 편집에서 6~8프레임 크로스페이드로 잇는다. 카메라 전진 속도를 맞춰 한 번의 연속 푸시처럼 보이게 한다.

### 크레딧 절약안 (선택)

- **장면 1**은 IMG1_916에 편집 툴 줌(켄 번즈)만 적용해도 된다. 크레딧이 들지 않고 고양이가 100% 동일하게 유지된다. 대신 깜빡임이 없다.
- **장면 2**는 편집 툴에서 IMG1 → IMG2 브러시 마스크 리빌(붓 모양 마스크로 닦아내듯 전환)로도 만들 수 있다. 형태 보존은 가장 확실하지만, AI 생성 특유의 "물감이 맺히는" 느낌은 약해진다.
- 이렇게 하면 Runway 생성은 **장면 3 한 번만** 필요하다.

## 4. 검수 체크리스트

- [ ] 고양이 얼굴, 눈 색, 귀 모양, 털무늬, 체형이 원본과 같다
- [ ] 고양이가 걷거나 고개를 돌리지 않는다 (깜빡임·호흡만 있다)
- [ ] 새 고양이, 사람, 물체가 나타나지 않는다
- [ ] 화면 안에 글자, 로고, 워터마크 형태가 생기지 않는다
- [ ] 하단에 Meta AI 워터마크가 한 프레임도 보이지 않는다
- [ ] 배경에서는 조명만 반짝이고 나머지는 정지해 있다
- [ ] 유화 질감(임파스토, 붓 자국)이 장면 3 전체에서 선명하다
