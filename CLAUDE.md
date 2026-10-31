# CLAUDE.md

## 프로젝트
- 이름: Magical Winter Forest Ice Rink
- 버전: **Save Point 01** (안정 버전, 2026-10-31)
- 내용: Three.js로 만든 한밤 겨울 숲속 야외 아이스링크 3D 장면

## 기준 파일
- `preview.html`: **현재 정상 작동 버전(Save Point 01)**이자 기본 결과물. 사용자가 보관한 `previous-version.html`과 내용이 같다.
- `winter-rink/`: 이후의 실험적 수정본(낙엽수 숲, 새 얼음 셰이더, 모바일 대응 등)이며 **적용되지 않은 버전**이다. 사용자가 요청하지 않으면 참고하거나 반영하지 않는다.

## 실행 방법
- `preview.html`을 더블클릭해 브라우저에서 연다. 설치는 필요 없다.
- Three.js 0.170.0을 jsDelivr CDN에서 불러오므로 인터넷 연결이 필요하다.
- 조작: WASD 또는 방향키로 캐릭터를 이동한다.

## preview.html 내부 구조
하나의 `<script type="module">` 안에 다음 섹션이 순서대로 들어 있다(각 섹션은 `// ===== 이름 =====` 주석으로 구분).

| 섹션 | 역할 |
|---|---|
| world/config.js | 링크 크기, 색상, 조명 세기, 블룸 값 등 모든 설정값 |
| world/warmGlow.js | 전구 빛이 눈과 잎에 은은하게 번지는 효과(셰이더 주입) |
| world/bulbs.js | 모든 전구를 Points 하나로 그리는 발광 스프라이트 |
| world/sky.js | 짙은 네이비 밤하늘, 희미한 별, 작은 달 |
| world/firTree.js | 전나무 형태(원뿔 층), 전구 감기 로직 |
| world/ground.js | 눈밭, 펜스와 나무 밑동의 눈더미 |
| world/iceRink.js | 반사 얼음(Reflector + 커스텀 셰이더), 펜스, 펜스 위 전구 |
| world/christmasTree.js | 중앙 대형 트리, 전구 약 1,700개, 별, 눈 섬 |
| world/forest.js | 외곽 전나무 22그루와 전구 |
| world/lights.js | PointLight 7개, 반구광, 달빛 |
| world/snowfall.js | 내리는 눈 |
| world/index.js | `createWinterWorld()`: 위 요소를 장면에 조립 |
| camera/cinematicCamera.js | 링크 전체와 트리를 담는 와이드 시네마틱 카메라 |
| player/PlaceholderPlayer.js | 캐릭터와 이동(키보드, 링크 안에서만 이동) |
| main.js | 렌더러, 블룸 후처리, 리사이즈, 애니메이션 루프 |

## 작업 규칙
- 기존 디자인·카메라·캐릭터·인터랙션을 임의로 변경하지 않는다.
- 요청한 부분만 최소한으로 수정한다.
- 전체 코드를 다시 쓰거나 불필요하게 파일을 분석하지 않는다.
- 작업 전에 기존 기능이 보존되는지 확인한다.
- 실제 브라우저에서 확인하지 않았다면 "검증 완료"라고 말하지 않는다. 확인하지 못했으면 그 사실을 분명히 밝힌다.
- 기본 결과물은 바로 미리 볼 수 있는 단일 HTML 파일(`preview.html`)이다. ZIP은 사용자가 요청할 때만 만든다.
- 사용자에게 불필요한 기술 설명이나 긴 작업 보고를 하지 않는다. 결과와 꼭 필요한 변경 사항만 짧게 알린다.
- 버전을 바꾸는 큰 수정 전에는 현재 `preview.html`을 새 세이브포인트로 보관할지 사용자에게 먼저 묻는다.
