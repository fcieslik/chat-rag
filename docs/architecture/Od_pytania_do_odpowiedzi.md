# Droga od zapytania do odpowiedzi

Architektura czatu AI na AWS. Dwanaście kroków od wiadomości użytkownika do odpowiedzi na ekranie.

---

## Przegląd

```
Użytkownik
   │
   ▼
1. Frontend ───────────────── React, AG-UI, streaming
   │
   ▼
2. API Gateway ───────────── auth, rate limiting, WAF
   │
   ▼
3. Filtry wejścia ────────── Bedrock Guardrails, AgentCore Policy
   │
   ▼
4. Sesja i historia ──────── DynamoDB albo AgentCore Memory
   │
   ▼
5. Orkiestracja ──────────── LangGraph, Strands, Harness
   │
   ├──▶ 6. RAG ───────────── Knowledge Bases, hybrid, rerank
   │
   ├──▶ 9. Narzędzia ─────── Lambda, AgentCore Gateway
   │
   ▼
7. Budowa promptu ────────── wersjonowanie, prompt cache
   │
   ▼
8. Wywołanie modelu ──────── Converse API, fallback, retry
   │
   ▼
10. Filtry wyjścia ───────── Guardrails, grounding check
   │
   ▼
11. Streaming ────────────── SSE, zdarzenia postępu
   │
   ▼
12. Zapis ────────────────── historia, ocena, koszt
```

---

## 1. Frontend

Użytkownik wysyła wiadomość. Frontend odbiera odpowiedź strumieniowo.

**Protokół:** AG-UI. To otwarty protokół zdarzeniowy z około 16 typami zdarzeń. Działa po HTTP, SSE albo WebSocket. Nie buduj własnego protokołu.

**Co AG-UI daje:**

- Streaming tokenów
- Anulowanie i wznowienie sesji
- Human-in-the-loop: pauza, zatwierdzenie, edycja, ponowienie
- Typowane przekazanie akcji do frontendu

**Wsparcie AWS:** AgentCore Runtime obsługuje AG-UI natywnie od marca 2026, obok MCP i A2A. Strands Agents ma integrację pierwszej strony.

**Wymagania interfejsu:**

| Wymaganie                        | Dlaczego                                     |
| -------------------------------- | -------------------------------------------- |
| Anulowanie generowania           | Użytkownik widzi złą odpowiedź i przerywa    |
| Optymistyczne wyświetlanie       | Wiadomość widoczna przed odpowiedzią serwera |
| Wznowienie po utracie połączenia | Mobilne sieci zrywają połączenia             |
| Widoczne wywołania narzędzi      | Użytkownik widzi postęp i nie porzuca sesji  |
| Cytowania źródeł                 | Wymóg zaufania i audytu                      |
| Przycisk oceny                   | Najcenniejsze dane do poprawy jakości        |

---

## 2. API Gateway i uwierzytelnianie

**Elementy:**

- Cognito albo zewnętrzny dostawca OIDC, token JWT
- API Gateway HTTP API z autoryzatorem JWT, albo ALB przed Fargate
- AWS WAF z regułami rate-based per IP
- Rate limiting per użytkownik w DynamoDB albo ElastiCache
- AgentCore Identity, gdy agent woła zewnętrzne API w imieniu użytkownika

**Ważne:** WAF ogranicza per IP. To nie wystarcza. Licz zapytania i tokeny per użytkownik osobno.

**Wybór warstwy serwerowej:**

| Opcja                       | Limit czasu | Uwagi                             |
| --------------------------- | ----------- | --------------------------------- |
| Lambda + response streaming | 15 min      | Zimny start, prosty koszt         |
| Fargate + ALB               | brak        | Pełna kontrola, własne skalowanie |
| AgentCore Runtime           | do 8 h      | Sesja w osobnym microVM           |

**Pułapka:** HTTP API nie obsługuje SSE dobrze. Dla streamingu wystaw ALB bezpośrednio albo CloudFront przed ALB. API Gateway zostaw dla zwykłych endpointów REST.

---

## 3. Filtry wejścia

Użyj Bedrock Guardrails jako osobnej warstwy, nie jako fragmentu promptu.

**Konfiguracja:**

| Filtr                | Co robi                                                      |
| -------------------- | ------------------------------------------------------------ |
| Filtry treści        | Przemoc, nienawiść, treści seksualne, niedozwolone działania |
| Denied topics        | Tematy zdefiniowane w języku naturalnym                      |
| Wykrywanie PII       | Maskowanie albo blokada, wzorce wbudowane i własne           |
| Prompt attack filter | Prompt injection i jailbreak                                 |
| Word filters         | Lista słów zakazanych                                        |

**Kluczowa zasada:** wołaj `ApplyGuardrail` jako osobne API, nie tylko jako parametr `InvokeModel`. Wtedy filtrujesz też treść, która nie idzie do Bedrock — na przykład dokumenty pobrane przez narzędzia. To główna luka w większości wdrożeń.

**Druga warstwa: AgentCore Policy.** Ocenia żądaną akcję przed jej dopuszczeniem, niezależnie od decyzji modelu. Reguły definiujesz w języku naturalnym, AgentCore tłumaczy je na polityki Cedar.

**Podział odpowiedzialności:**

- Guardrails pilnuje **treści**
- Policy pilnuje **akcji**

---

## 4. Sesja, historia i pamięć

**Dwie opcje:**

|                                 | Własne (DynamoDB / Postgres)    | AgentCore Memory                              |
| ------------------------------- | ------------------------------- | --------------------------------------------- |
| Model zapytań                   | SQL albo klucz-wartość, dowolny | Tylko po `memoryId` + `actorId` + `sessionId` |
| Agregacje i joiny               | Tak                             | Nie                                           |
| Powiązanie z danymi biznesowymi | Klucze obce                     | Brak                                          |
| Ekstrakcja faktów               | Piszesz sam                     | Automatyczna, asynchroniczna                  |
| Koszt                           | Za instancję                    | Za zdarzenie i za odczyt                      |

**Rekomendacja:** Postgres albo DynamoDB jako źródło prawdy na pełną historię. AgentCore Memory tylko na fakty długoterminowe o użytkowniku — to jest jedyna rzecz, której własna baza nie zrobi bez pipeline'u ekstrakcji.

**Ostrzeżenia dotyczące Memory:**

- Identyfikatory aktora i sesji **organizują dane, ale nie uwierzytelniają**. Izolacja tenantów pozostaje po Twojej stronie
- Metadane zdarzeń nie są szyfrowane kluczem klienta. Nie umieszczaj tam treści wrażliwych
- Rekordy długoterminowe to wygenerowany kontekst, nie zweryfikowana prawda
- Ekstrakcja jest asynchroniczna. Fakt nie jest dostępny natychmiast po rozmowie

**Zarządzanie kontekstem — trzy strategie:**

1. **Okno przesuwne** — ostatnie N wiadomości. Proste, traci kontekst
2. **Streszczenie** — model streszcza starsze tury. Kosztuje dodatkowe wywołanie
3. **Hybryda** — streszczenie starszych tur plus pełne ostatnie N. To standard

Mierz długość kontekstu jako metrykę. Rosnący kontekst to rosnący koszt i opóźnienie.

---

## 5. Orkiestracja i rozpoznawanie intencji

### Cztery podejścia do intencji

**A. Bez osobnego klasyfikatora** — model sam wybiera narzędzie.

- Zalety: zero dodatkowej latencji, zero kodu, radzi sobie z niejednoznacznością
- Wady: brak kontroli, trudniej egzekwować polityki per intencja, droższe
- Kiedy: mniej niż 10 narzędzi, brak różnych polityk per typ zapytania

**B. Router na małym modelu** — osobne wywołanie Nova Lite albo Claude Haiku ze strukturalnym wyjściem.

```
System: Zwróć wyłącznie JSON.
{"intent": "...", "confidence": 0.0-1.0, "needs_retrieval": bool}
Dozwolone: product_question | account_issue | smalltalk | out_of_scope
```

- Zalety: tanie, około 200-400 ms, pozwala kierować na różne modele i polityki
- Wady: dodatkowa latencja, dodatkowy punkt awarii, taksonomia do utrzymania
- Wymuś strukturę przez `toolChoice`, nie przez prośbę w prompcie

**C. Klasyfikator na embeddingach** — porównanie z centroidami intencji.

- Zalety: 20-50 ms, bardzo tanie, deterministyczne, testowalne
- Wady: wymaga 20-30 przykładów per intencja, słabo radzi sobie z wieloma intencjami naraz, nie widzi kontekstu rozmowy
- Dobre też do wykrywania zapytań poza zakresem

**D. Graf z warunkami (LangGraph)** — klasyfikacja jako węzeł, krawędzie warunkowe.

- Kiedy: wieloetapowe przepływy z pętlami, zatwierdzeniami i ścieżkami naprawy

### Rekomendacja

Zacznij od **A**. Dodaj **B** albo **C** dopiero po zmierzeniu konkretnego problemu: kosztu, opóźnienia albo potrzeby różnych reguł bezpieczeństwa. Przedwczesny router to najczęstsza nadmierna inżynieria.

**Zawsze mierz:** rozkład intencji, odsetek `out_of_scope`, odsetek niskiej pewności.

### Warstwa wykonawcza

| Poziom                           | Co to jest                                     | Kiedy                           |
| -------------------------------- | ---------------------------------------------- | ------------------------------- |
| AgentCore Harness                | Agent w konfiguracji, AWS uruchamia pętlę      | Standardowy czat, szybki start  |
| Własny graf na AgentCore Runtime | Twój LangGraph lub Strands, infrastruktura AWS | Nietypowy przepływ              |
| Wszystko własne (ECS, Lambda)    | Pełna kontrola, pełna praca                    | Wymagania poza zakresem Runtime |

**Uwaga:** Bedrock Agents Classic przeszedł w tryb utrzymania dla nowych klientów po 30 lipca 2026. Nowe projekty używają AgentCore.

---

## 6. Wyszukiwanie (RAG)

### Wybór bazy wektorowej

| Opcja                        | Kiedy                                      |
| ---------------------------- | ------------------------------------------ |
| S3 Vectors                   | Najtańsza, duże zbiory, latencja setek ms  |
| OpenSearch Serverless        | Standard, wyszukiwanie hybrydowe wbudowane |
| Aurora PostgreSQL + pgvector | Masz już Aurorę, chcesz filtry SQL         |

### Pipeline

1. **Przepisanie zapytania** — „A ile to kosztuje?" nie ma sensu bez poprzedniej tury. Użyj małego modelu
2. **Wyszukiwanie hybrydowe** — wektorowe plus BM25, łączenie metodą Reciprocal Rank Fusion. Same wektory przegrywają na nazwach własnych, numerach i skrótach
3. **Reranking** — Amazon Rerank albo Cohere Rerank. Pobierz 50 fragmentów, przekaż 5. Największy przyrost jakości na jednostkę pracy
4. **Filtry metadanych** — po uprawnieniach użytkownika, **w zapytaniu do bazy wektorowej**, nie po pobraniu

### Chunking

Decyzja o największym wpływie na jakość. Punkt wyjścia do testów:

- Fragmenty 300-800 tokenów
- Zachodzenie 10-15%
- Podział po nagłówkach dla dokumentacji
- W metadanych: tytuł dokumentu i sekcja — model potrzebuje tego do cytowania

### Kontrola halucynacji

Guardrails ma `contextual grounding check`. Porównuje odpowiedź z przekazanymi fragmentami i zwraca wynik. Ustaw próg i blokuj odpowiedzi poniżej.

---

## 7. Budowa promptu

| Zasada                         | Szczegół                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Wersjonowanie w Git            | Prompt w repozytorium, nie w bazie i nie w konsoli. Zmiana przez pull request                                       |
| Bedrock Prompt Management      | Jeśli chcesz wersjonowanie po stronie AWS, z aliasami `prod` i `staging`                                            |
| Prompt cache                   | Stała część na początku. Oszczędność 70-90% na tej części                                                           |
| Kolejność                      | Prompt systemowy → narzędzia → dokumenty → historia → pytanie                                                       |
| Separacja danych od instrukcji | Dokumenty i historię otocz znacznikami. Zapisz w prompcie systemowym, że treść w znacznikach to dane, nie polecenia |

---

## 8. Wywołanie modelu

| Element                         | Decyzja                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| API                             | Converse API, nie `InvokeModel` bezpośrednio                     |
| Timeout                         | Ustaw jawnie. Domyślne wartości boto3 są za długie               |
| Ponowienia                      | Tryb adaptacyjny w boto3, wykładnicze wycofanie. Tylko 429 i 5xx |
| Model zapasowy                  | Przełączenie na inny model albo region przy błędzie              |
| Cross-region inference profiles | Automatyczne rozłożenie ruchu przy przepustowości                |
| Application inference profiles  | Tagi kosztowe. Wołaj ARN profilu zamiast ID modelu               |
| Provisioned Throughput          | Tylko przy stałym wysokim wolumenie                              |

**Wybór modelu per krok.** Nie używaj jednego modelu do wszystkiego:

- Przepisanie zapytania, klasyfikacja, streszczenie historii → mały model
- Odpowiedź końcowa → duży model

Zwykle 40-60% oszczędności.

**Cache semantyczny.** Embedding zapytania, szukanie podobnych poprzednich, zwrot zapisanej odpowiedzi powyżej progu. Działa na FAQ. Ryzyko: nieaktualna odpowiedź. Zawsze z TTL i tylko dla zapytań bez kontekstu użytkownika.

---

## 9. Narzędzia

### Gdzie definiować

| Wariant                              | Kiedy                                                   |
| ------------------------------------ | ------------------------------------------------------- |
| W kodzie agenta (Strands, LangGraph) | 1 agent, mniej niż 10 narzędzi, wszystkie Twoje         |
| AgentCore Gateway                    | Istniejące API, klucze zewnętrzne, wielu agentów, audyt |

**Gateway to zarządzany serwer MCP, który proxy'uje Twoje API.** Kod zostaje w Lambdzie albo za Twoim API. Gateway stoi przed nim.

### Typy targetów Gateway

| Typ         | Schemat narzędzia          |
| ----------- | -------------------------- |
| API Gateway | Generowany z definicji API |
| OpenAPI     | Generowany ze specyfikacji |
| Smithy      | Generowany z modelu        |
| MCP Server  | Wykrywany automatycznie    |
| **Lambda**  | **Podajesz ręcznie**       |

### Zasady

- **Najmniejsze uprawnienia** — osobna rola IAM per narzędzie, nie jedna dla agenta
- **Walidacja parametrów** — Pydantic po stronie narzędzia. Model potrafi wygenerować błędne wartości
- **Idempotencja** — klucz idempotencji dla narzędzi zapisujących. Agent może ponowić wywołanie
- **Rozdziel czytanie od zapisu** — zapis wymaga zatwierdzenia użytkownika albo polityki Cedar
- **Budżet kroków** — limit wywołań narzędzi na turę. Bez limitu agent wpada w pętlę i generuje koszt
- **Grupowanie** — narzędzia według domeny biznesowej. Do jednego targetu Gateway dołączasz tylko jednego dostawcę poświadczeń wychodzących

---

## 10. Filtry wyjścia

Ten sam mechanizm Guardrails, inne progi.

- Filtry treści na odpowiedzi
- Maskowanie PII, szczególnie gdy agent czytał bazę danych
- `contextual grounding check`
- **Sensitive Data Protection w CloudWatch Logs**, żeby PII nie trafiło do logów. To osobna konfiguracja, często pomijana

### Problem przy streamingu

Nie możesz sprawdzić pełnej odpowiedzi, dopóki nie jest gotowa.

| Rozwiązanie                                         | Ocena                                         |
| --------------------------------------------------- | --------------------------------------------- |
| Sprawdzanie w blokach (Guardrails w trybie `async`) | Standard                                      |
| Bufor i sprawdzenie całości, potem stream           | Bezpieczne, wolniejsze                        |
| Stream bez sprawdzania, usunięcie po fakcie         | Niebezpieczne — użytkownik już zobaczył treść |

---

## 11. Streaming

- AG-UI po SSE dla jednokierunkowego strumienia
- WebSocket, gdy potrzebujesz kanału zwrotnego w trakcie (zatwierdzenia, przerwania)
- Wysyłaj zdarzenia pośrednie: `TOOL_CALL_START`, `TOOL_CALL_END`, `STATE_DELTA`
- **Time to first token** to najważniejsza metryka odczuwalnej szybkości. Mierz osobno od czasu całkowitego
- Zapisuj częściową odpowiedź po stronie serwera, pozwól na wznowienie po `session_id`

### Pułapka proxy

Jeśli Express stoi między frontendem a agentem, musi przepuścić strumień bez buforowania:

```js
app.post('/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const out = await agentCore.send(new InvokeAgentRuntimeCommand({...}));
  for await (const chunk of out.response) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end();
});
```

Objaw błędu: działa lokalnie, a po wdrożeniu odpowiedź przychodzi jednym blokiem na końcu.

---

## 12. Zapis i pętla zwrotna

**Co zapisać:**

- Wiadomość i odpowiedź
- Użyte fragmenty dokumentów
- Wywołane narzędzia
- `trace_id`
- Koszt w tokenach, tag użytkownika i tenanta

**Ocena użytkownika** — przycisk w górę i w dół plus opcjonalny komentarz.

**Pętla poprawy:**

```
negatywna ocena
   → przegląd śladu w CloudWatch
   → dodanie przypadku do zbioru ewaluacyjnego
   → poprawka promptu lub retrievalu
   → bramka CI potwierdza
   → wdrożenie
```

Bez tej pętli robisz poprawki na wyczucie.

---

## Warstwy przekrojowe

### Observability

**Produkcja:** CloudWatch GenAI Observability.

- Po `agentcore deploy` CLI wstrzykuje instrumentację OpenTelemetry bez zmian w kodzie
- Widoki: Agents, Sessions, Traces
- Konfiguracja jednorazowa: włącz Transaction Search w CloudWatch (Application Signals → Transaction search), zaznacz zapis spanów jako logów strukturalnych. Spany trafiają do grupy logów `aws/spans`. Odczekaj około 10 minut
- Agenty utworzone od 20 lipca 2026 używają ujednoliconej telemetrii i wymagają ADOT 0.18.0 lub nowszego

**Poza AgentCore Runtime:** instrumentujesz ADOT samodzielnie. Eksport na natywny endpoint OTLP CloudWatch, podpisany SigV4.

**Instrumentuj do standardu, nie do dostawcy.** Standardem od kwietnia 2026 są konwencje semantyczne OpenTelemetry GenAI (przestrzeń `gen_ai.*`, oznaczona jako eksperymentalna). Zmiana zaplecza to wtedy zmiana eksportera.

**MLflow na SageMaker** — do eksperymentów offline, nie do produkcji:

- Śledzenie wersji promptu, modelu i wyników ewaluacji
- Porównywanie przebiegów między zmianami
- Podział: MLflow = laboratorium, CloudWatch = produkcja

### Co mierzyć

| Kategoria      | Metryki                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| Wydajność      | Time to first token, czas całkowity, p95 i p99                                |
| Koszt          | Tokeny wejścia i wyjścia per sesja, koszt na udaną sesję, trafność cache      |
| Jakość         | Wynik ugruntowania, odsetek odmów, poprawność wyboru narzędzia                |
| Zachowanie     | Długość trajektorii, odsetek zapytań poza zakresem, liczba tur do rozwiązania |
| Bezpieczeństwo | Liczba zadziałań Guardrails, liczba blokad Policy                             |

Ustaw SLO z budżetem błędu. Alarmy CloudWatch → EventBridge → SNS.

### Ewaluacja

**Dwie warstwy, nie jedno narzędzie.**

**Offline — bramka w CI:**

| Narzędzie | Rola                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| DeepEval  | Asercje pass/fail, blokada merge. Agenty, RAG, rozmowy wielotorowe, Pytest    |
| Ragas     | Wąska biblioteka do metryk retrievalowych. Można uruchamiać wewnątrz DeepEval |
| promptfoo | Red-teaming, odporność na jailbreak, testy zgodności                          |

Zbiór 50-200 przypadków. Metryki: faithfulness, answer relevancy, context precision, context recall, poprawność wyboru narzędzia. Bramka na pull request przy zmianie promptu, modelu albo parametrów retrievalu.

**Online — AgentCore Evaluations:** 13 gotowych evaluatorów (pomocność, wybór narzędzia, dokładność odpowiedzi) plus własne systemy oceny. Metryki jakości i telemetria w jednym dashboardzie CloudWatch.

**Najważniejsze:** nie zaczynaj od wyboru narzędzia. Zacznij od zbudowania zbioru danych i punktu odniesienia. Metoda ma większe znaczenie niż framework.

### Koszty

- Application inference profile z tagiem per projekt
- Pomiar tokenów per użytkownik i per zapytanie
- Limity budżetu, egzekwowane **przed** wywołaniem modelu

Uwaga przy AgentCore Gateway z inference targets: Bedrock rejestruje rolę IAM gateway jako tożsamość wywołującego. Application inference profiles i tagowanie metadanych per żądanie nie działają na tej ścieżce. Najdrobniejsza wbudowana granularność to per projekt per dzień w CUR 2.0. Atrybucję per użytkownik i twarde budżety dodajesz interceptorami Lambda.

### Bezpieczeństwo i zgodność

**Szyfrowanie:**

| Warstwa          | Mechanizm                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Dane w spoczynku | KMS z kluczem zarządzanym przez klienta (CMK), osobny klucz per tenant w środowisku regulowanym |
| Dane w tranzycie | TLS 1.2 lub wyższy, VPC endpoints dla Bedrock, żeby ruch nie wychodził do internetu             |
| Logi             | Sensitive Data Protection w CloudWatch Logs                                                     |
| AgentCore Memory | Metadane zdarzeń **nie są** szyfrowane kluczem klienta — nie umieszczaj tam treści wrażliwych   |

**Retencja historii:**

- Ustal okres retencji przed wdrożeniem, nie po
- TTL w DynamoDB na automatyczne usuwanie
- Archiwum do S3 z Object Lock, gdy wymagany jest zapis niezmienny
- Procedura usunięcia danych na żądanie osoby — musi obejmować historię, indeks wektorowy i logi

**RODO:**

| Wymóg                        | Co trzeba zrobić                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Podstawa prawna i informacja | Zgoda albo prawnie uzasadniony interes, informacja w interfejsie czatu                  |
| Minimalizacja                | Maskowanie PII przed wysłaniem do modelu                                                |
| Prawo do usunięcia           | Usunięcie musi objąć też fragmenty w bazie wektorowej i wpisy w pamięci długoterminowej |
| Lokalizacja danych           | Wybór regionu. Uwaga na cross-region inference profiles — ruch może wyjść poza region   |
| Powierzenie przetwarzania    | Umowa z dostawcą modelu, ocena podprzetwarzających                                      |
| DPIA                         | Wymagana przy systematycznej ocenie osób albo przetwarzaniu na dużą skalę               |

**AI Act:**

- Ustal klasyfikację systemu: minimalne ryzyko, ograniczone ryzyko czy wysokie ryzyko. Czat obsługi klienta zwykle mieści się w ograniczonym ryzyku
- Obowiązek przejrzystości: użytkownik musi wiedzieć, że rozmawia z systemem AI
- Dokumentacja techniczna: opis modelu, danych, ograniczeń i znanych trybów awarii
- Nadzór człowieka: ścieżka eskalacji do operatora
- Rejestr zdarzeń: logi wystarczające do odtworzenia decyzji
- Terminy stosowania zależą od klasyfikacji — zweryfikuj aktualny harmonogram przed wdrożeniem

**Praktyka w środowisku regulowanym:**

- Prompt systemowy i wersja modelu w każdym wpisie audytowym
- Zapis niezmienny dla decyzji wpływających na klienta
- Rozdzielenie środowisk: osobne konta AWS dla dev, test i produkcji
- Przegląd bezpieczeństwa narzędzi zapisujących — każde traktuj jak zmianę w systemie transakcyjnym

### Skalowanie

**Bezstanowy backend.** Kontener nie trzyma stanu sesji. Warunek skalowania poziomego i restartu bez utraty rozmowy.

| Element                             | Gdzie trzymać                                             |
| ----------------------------------- | --------------------------------------------------------- |
| Stan sesji, cache kontekstu         | ElastiCache for Redis albo DynamoDB                       |
| Pełna historia                      | Postgres albo DynamoDB                                    |
| Częściowa odpowiedź przy streamingu | Redis z krótkim TTL, do wznowienia po zerwaniu połączenia |

**Kolejki dla długich zadań.** Zadania powyżej kilkudziesięciu sekund nie idą ścieżką synchroniczną:

```
Zapytanie → SQS → worker (ECS albo AgentCore Runtime)
                     │
                     └─→ wynik do DynamoDB
                          │
                          └─→ powiadomienie przez WebSocket albo polling
```

- SQS z kolejką martwych listów (DLQ) na zadania, które padły
- Klucz idempotencji, żeby ponowienie nie wykonało operacji dwa razy
- Frontend pokazuje pozycję w kolejce zamiast blokować interfejs

**Pozostałe wzorce skalowania:**

| Wzorzec                | Co rozwiązuje                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Backpressure           | Przy przeciążeniu zapytania trafiają do kolejki, nie są odrzucane                             |
| Bulkhead               | Osobne pule zasobów per tenant. Jeden klient nie wyczerpuje limitów pozostałych               |
| Circuit breaker        | Po serii błędów dostawcy przestajesz go wołać na określony czas                               |
| Graceful degradation   | Model główny → model zapasowy → odpowiedź z cache → komunikat o awarii. Drabina, nie błąd 500 |
| Sharding kont AWS      | Izolacja limitów Bedrock między zespołami albo jednostkami                                    |
| Cross-region inference | Rozłożenie obciążenia między regiony — sprawdź zgodność z wymogiem lokalizacji danych         |

**Limity, o które trzeba zawczasu wystąpić:** limity tokenów na minutę i zapytań na minutę w Bedrock są miękkie i regionalne. Zwiększenie wymaga zgłoszenia i czasu. Sprawdź je przed testami obciążeniowymi, nie w ich trakcie.

---

## Trzy rzeczy, które robi się za późno

1. **Zbiór ewaluacyjny.** Buduj od pierwszego dnia, nawet 20 przypadków. Bez niego każda zmiana promptu to zgadywanie
2. **Atrybucja kosztów.** Taguj każde wywołanie identyfikatorem użytkownika i sesji. Bez tego nie wiesz, co kosztuje
3. **Cytowania.** Zaprojektuj przekazywanie źródeł od początku. Dodanie ich później wymaga zmiany schematu, promptów i interfejsu

---

## Referencyjny stos na AWS

```
Frontend:      React + @ag-ui/client
Protokół:      AG-UI (SSE)
Runtime:       AgentCore Runtime
Framework:     Strands Agents albo LangGraph
Model:         Bedrock Converse API, wiele modeli per krok
Narzędzia:     AgentCore Gateway (MCP) + Lambda
Autoryzacja:   Cognito + AgentCore Identity + AgentCore Policy
Guardrails:    Bedrock Guardrails (ApplyGuardrail, wejście i wyjście)
RAG:           Bedrock Knowledge Bases + OpenSearch Serverless + Rerank
Pamięć:        Postgres (źródło prawdy) + AgentCore Memory (fakty)
Observability: ADOT (gen_ai.*) → CloudWatch GenAI Observability
Eval offline:  DeepEval w CI + promptfoo do red-teamingu
Eval online:   AgentCore Evaluations
Eksperymenty:  MLflow na SageMaker
IaC:           CDK albo Terraform
```

**Wersja minimalna na start:**

```
Frontend:      React + Vite na S3
Backend:       Express albo FastAPI na ECS
Model:         Bedrock Converse API
Framework:     LangGraph
RAG:           Bedrock Knowledge Base
Guardrails:    Bedrock Guardrails
Historia:      DynamoDB
Koszty:        Application inference profile z tagiem
```

Zero AgentCore. Jeden deployment. Dodawaj pojedyncze usługi AgentCore, gdy zmierzysz konkretny problem.
