# Zarys architektury katalogów

Status: propozycja

Dokument opisuje docelowy podział monorepo dla projektu AWS Chat RAG. Szczegóły etapów i kolejność prac znajdują się w [`ROADMAP.md`](../../ROADMAP.md).

## Założenia

- Frontend i backend są niezależnymi aplikacjami.
- Frontend używa React, Vite i TypeScript; wynik buildu jest publikowany do S3 i serwowany przez CloudFront.
- Backend używa Node.js, Express i TypeScript; jest pakowany jako obraz Docker i uruchamiany na ECS/Fargate.
- Backend jest początkowo stateless.
- Wspólnym punktem integracji są kontrakty komunikacji, a nie współdzielona logika biznesowa.
- Infrastrukturę tworzymy początkowo ręcznie w AWS Console; IaC dodamy później.

## Struktura katalogów

```text
chat-rag/
├── apps/
│   ├── web/                         # React + Vite → S3 + CloudFront
│   │   ├── src/
│   │   │   ├── app/                 # router, providery, konfiguracja
│   │   │   ├── features/
│   │   │   │   └── chat/            # UI i stan funkcji chatu
│   │   │   └── shared/              # elementy współdzielone tylko przez web
│   │   ├── public/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── api/                         # Express → ECR → ECS/Fargate
│       ├── src/
│       │   ├── app.ts               # konfiguracja Expressa
│       │   ├── server.ts            # uruchomienie procesu
│       │   ├── modules/
│       │   │   └── chat/            # przypadek użycia i interfejs chatu
│       │   ├── adapters/
│       │   │   └── llm/             # OpenAI teraz, Bedrock później
│       │   ├── http/                # middleware, obsługa błędów, routing
│       │   └── config/              # konfiguracja środowiska
│       ├── tests/
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── contracts/                   # wspólne schematy request/response
│       ├── src/
│       │   ├── chat.ts
│       │   ├── errors.ts
│       │   └── index.ts
│       └── package.json
│
├── docs/
│   ├── architecture/
│   │   └── folder-structure.md
│   ├── aws/                         # notatki i procedury z AWS Console
│   └── adr/                         # decyzje architektoniczne
│
├── .github/workflows/
│   ├── deploy-web.yml
│   └── deploy-api.yml
├── pnpm-workspace.yaml
└── package.json
```

## Odpowiedzialność aplikacji

### `apps/web`

Zawiera wyłącznie frontend oraz jego lokalną implementację interfejsu użytkownika. Nie powinien zawierać kluczy OpenAI, sekretów AWS ani logiki wymagającej zaufanego środowiska.

Wartość `VITE_API_URL` wskazuje publiczny adres backendu, np. `https://api.example.com`.

### `apps/api`

Zawiera Expressa, endpoint `POST /chat`, walidację, obsługę streamingu i logikę przypadku użycia chatu.

Moduł `chat` powinien zależeć od małego interfejsu providera LLM. Konkretne integracje, takie jak OpenAI i Bedrock, są adapterami implementującymi ten interfejs. Dzięki temu fallback providera pozostaje wewnątrz backendu i nie zmienia interfejsu chatu.

Przykładowe przyszłe moduły:

- `auth/` — Cognito i kontekst użytkownika,
- `persistence/` — zapis rozmów,
- `retrieval/` — wyszukiwanie kontekstu RAG,
- `agents/` — narzędzia i funkcje agentowe.

Nie trzeba tworzyć tych katalogów przed rozpoczęciem odpowiednich faz roadmapy.

### `packages/contracts`

To wspólny interfejs pomiędzy frontendem i backendem. Powinien zawierać schematy i typy dla:

- wiadomości chatu,
- requestów i response’ów,
- błędów,
- ewentualnie metadanych streamingu.

Nie powinien zawierać dostępu do AWS, OpenAI, bazy danych ani logiki biznesowej.

## Niezależne wdrażanie

| Aplikacja | Źródło | Artefakt | Wdrożenie |
|---|---|---|---|
| Frontend | `apps/web` + `packages/contracts` | `dist/` | S3 → CloudFront |
| Backend | `apps/api` + `packages/contracts` | obraz Docker | ECR → ECS/Fargate |

Zmiana w `apps/web` nie powinna uruchamiać wdrożenia backendu, a zmiana w `apps/api` nie powinna wymagać ponownego wdrożenia frontendu, o ile kontrakt pozostaje kompatybilny.

Zmiany kontraktu powinny być najpierw rozszerzające i kompatybilne wstecz. Zmianę łamiącą kontrakt należy wdrażać skoordynowanie albo przez wersjonowany endpoint, np. `/v1/chat` i `/v2/chat`.

## Infrastruktura

Podczas fazy ręcznej konfiguracji AWS notatki, diagramy i checklisty powinny trafiać do `docs/aws/`.

Po przejściu na IaC można dodać osobne stosy:

```text
infra/
├── web/                             # S3, CloudFront, DNS
├── api/                             # ECR, ECS, ALB, IAM, Secrets Manager
└── shared/                          # tylko zasoby rzeczywiście wspólne
```

Stosy `web` i `api` powinny mieć niezależny stan oraz niezależny proces wdrażania.

Docelowy przepływ ruchu:

```text
Browser → CloudFront → S3
Browser → API Gateway → ALB → ECS/Fargate → OpenAI lub Bedrock
```

AWS WAF jest przypinany do chronionego zasobu, np. API Gateway, ALB albo CloudFront; nie jest osobnym etapem przepływu ruchu. Szczegóły opisuje [dokumentacja AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-associating-aws-resource.html).

## Przyszły worker RAG

Jeżeli ingestia dokumentów stanie się asynchronicznym procesem uruchamianym przez zdarzenia z S3 lub kolejkę, można dodać niezależną aplikację:

```text
apps/
└── ingestion/                      # opcjonalny worker RAG
```

Do tego momentu retrieval i ingestia powinny pozostać modułami backendu, aby nie zwiększać liczby wdrażanych aplikacji bez rzeczywistej potrzeby.

## Dokumentacja domenowa

Po przyjęciu monorepo warto przejść z jednego kontekstu na mapę kontekstów:

```text
CONTEXT-MAP.md
apps/web/CONTEXT.md
apps/api/CONTEXT.md
docs/adr/
```

`CONTEXT-MAP.md` powinien wskazywać, który dokument opisuje frontend, backend i pojęcia wspólne dla całego produktu.
