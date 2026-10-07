/**
 * 명령줄 실행 시 .env.local 을 읽는다(Next 앱은 자동으로 읽음).
 * 다른 모듈보다 먼저 import 해야 모델 ID·도구 경로 같은 상수에 반영된다.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* 파일이 없으면 넘어감 */
  }
}
