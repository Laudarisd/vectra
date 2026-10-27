# Vectra AI for VS Code

[English](../../apps/vscode-extension/README.md) · [한국어 홈](README.md)

Vectra AI는 로컬 모델과 클라우드 AI를 지원하는 VS Code 코딩 에이전트입니다.

## 주요 기능

- 프로젝트와 선택한 코드 이해
- 파일을 바꾸기 전 수정 내용 검토
- 승인된 작업 공간 도구와 터미널 명령 실행
- 계획, 코딩, 테스트, 리뷰, 보안, 문서화 전문 에이전트
- llama.cpp, Ollama, OpenAI, Anthropic, Gemini 및 호환 API 지원
- 이미지와 PDF, DOCX, PPTX, XLSX 첨부 지원

## 개발

저장소 루트에서 실행합니다.

```sh
npm install
npm run build -w vectra-ai
npm test -w vectra-ai
npm run package:extension
```

생성된 `.vsix` 파일은 VS Code의 **Extensions → Install from VSIX**에서 설치할 수 있습니다.

API 키는 VS Code SecretStorage에 저장되며, 파일 수정과 명령 실행에는 검토 또는 확인 과정이 적용됩니다.
