# KTX2/Basis 측정과 운영 정책

## 적용 범위

이 경로는 큰 atlas의 전송량과 GPU texture storage를 줄이기 위한 opt-in 기능이다.
원본 PNG/JPEG/WebP URL은 유지한다. Native WebGPU, 미지원 GPU 형식, 잘못된 파일,
색 공간 불일치, legacy alpha 입력, decoder/업로드 실패는 원본 이미지로 fallback한다.
ETC1S/UASTC LDR 단일 2D, 4의 배수인 크기, level 0, 최대 8192²/64 MiB만 지원한다.
ASTC 4×4, BC7, ETC2 RGBA 순으로 장치 지원을 확인한다. premultiplied/HDR/cube/array는 지원하지 않는다.

## 측정 결과

2026-10-03 KST, WSL2 Node 24에서 공식 Basis v2.50 encoder를 사용했다.
512²는 deterministic gradient/noise atlas이며 저장소 PNG encoder(filter 0) 결과다.
따라서 최적화된 PNG/WebP와의 일반적인 압축률 보장이 아니다. 작은 sprite는 실제 Shooter player.png다.

| 원본 | PNG bytes | ETC1S bytes / PSNR | UASTC+Zstd bytes / PSNR | RGBA → GPU block bytes |
| --- | ---: | ---: | ---: | ---: |
| 512² atlas | 816,256 | 60,001 / 35.88 dB | 251,560 / 46.57 dB | 1,048,576 → 262,144 |
| 32² pixel sprite | 212 | 462 / 25.31 dB | 405 / 64.08 dB | 4,096 → 1,024 |

PSNR은 encoder의 RGBA32 복원과 원본을 비교한 값이다. ETC1S/UASTC encode는 atlas에서
각각 약 1,114/927 ms, BC7 transcode는 8.05/2.46 ms였다. 단일 로컬 실행의 CPU 수치다.
[원본 측정 report](https://github.com/silbaram/ferrum2d/blob/main/tests/fixtures/ktx2/measurement.json)에 byte·시간·화질 값을 보관한다.

실제 Chromium 148/ANGLE SwiftShader browser smoke에서는 ASTC 업로드가 선택됐다.
DPR 1/2 readback PSNR은 ETC1S 35.67~36.95, UASTC 46.73~48.01 dB였다.
첫 decoder 포함 load 약 79~91 ms, warm UASTC 13~14 ms, PNG 10~15 ms였다.
로컬 서버의 fetch·Worker 초기화·변환·GPU 제출까지 포함한 값이며 네트워크나 GPU 실행시간 벤치마크가 아니다.
작은 pixel sprite에는 전송량/화질 관점에서 PNG 유지가 유리하다. GPU driver 내부 overhead는 byte 추정에서 제외한다.

## 의존성, 라이선스, 배포

공식 [Basis Universal](https://github.com/BinomialLLC/basis_universal)의 v2_50,
commit `9bebe16726b3a61c8c213eeee3b7cffb462ef34e` decoder를 vendor한다.
자체 transcoder 구현과 추가 npm wrapper 대신 upstream의 JS/Wasm을 사용한다.
upstream JS 50,538 bytes + Wasm 1,060,846 bytes, gzip 합 470,058 bytes였다.
ES module export와 수정 고지 이외에는 generated decoder를 변경하지 않는다.
Apache-2.0 LICENSE/NOTICE 및 Zstd BSD license를 함께 배포한다.
[provenance](https://github.com/silbaram/ferrum2d/blob/main/packages/ferrum-web/vendor/basis/provenance.json)의 SHA-256을 build에서 검사한다.

package `dist/vendor/basis`와 `dist/ktx2Worker.js`는 tarball 필수 파일이다.
Vite는 Worker/JS/Wasm을 별도 asset으로 배출한다. 파일은 번들 산출물에 포함되지만
KTX2를 요청하기 전에는 decoder를 fetch/실행하지 않는다. CDN 기본값이나 외부 서비스 의존은 없다.
직접 배포 시 module Worker/JS의 JavaScript MIME, Wasm의 application/wasm, CORS와
CSP의 worker-src/script-src 및 Wasm 실행 허용 정책을 맞춘다. 다른 위치에 호스팅하면
`createKtx2Transcoder({ workerUrl, transcoderJsUrl, transcoderWasmUrl })`로 URL을 지정한다.

Worker는 요청당 30초 timeout, 최대 32개 대기를 허용한다. 취소와 destroy가 late upload를 막으며
마지막 요청 취소는 Worker를 종료한다. 공유 decoder는 주입한 caller가 해제한다.
upstream 갱신 시 commit/hash/license를 함께 갱신하고 byte/PSNR 비교, 오류/취소/해제,
raw ESM 및 Vite smoke, package tarball 검사를 다시 수행한다.

## 캐시 정책과 재현

압축 후보는 브라우저 HTTP cache를 사용한다. 내용 hash/version을 URL에 포함해 갱신한다.
`assetManifestFingerprint`에는 ktx2Url이 포함된다. 기존 preload/IndexedDB pipeline은
fallback 이미지 URL을 warmup하며 KTX2 binary를 별도 캐싱하지 않는다. preload를 함께 사용하면
이미지와 KTX2 양쪽 전송이 발생할 수 있으므로 큰 atlas의 preload 선택을 조정한다.

재현은 위 commit의 `webgl/encoder/build/basis_encoder.js`와 `.wasm`을 별도 임시 디렉터리에
받은 뒤 저장소 root에서 실행한다. encoder는 개발 측정 전용이며 runtime package에 포함하지 않는다.

```bash
node scripts/tools/measure-ktx2.mjs /tmp/ferrum-basis-encoder /tmp/ferrum-ktx2-measure
pnpm smoke:ktx2
pnpm package:check:ferrum-web
```

테스트 fixture는 생성된 atlas 3개와 16² RGBA 사분면 alpha fixture다.
alpha는 UASTC, forceAlpha/checkForAlpha, no mip, sRGB, Zstd로 생성했다.
시각 기준은 [public API 계약](../../engine/public-api/core.md)을 따른다.
