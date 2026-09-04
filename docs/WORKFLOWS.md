# Workflows

## Development workflow

```mermaid
flowchart LR
    A[Evidence and regression case] --> B[Change maintained source]
    B --> C[Python tests]
    B --> D[TypeScript type check and tests]
    C --> E[Repository policy and credential scan]
    D --> E
    E --> F[Source-only review branch]
    F --> G{Release gate}
    G -->|source approved| H[Public source]
    G -->|binary requirements incomplete| I[No application download]
```

## Runtime workflow

```mermaid
flowchart TD
    A[Scan barcode or type ISBN] --> B[Normalize and validate]
    B --> C{Valid check digit?}
    C -->|No| D[Explain error; do not guess]
    C -->|Yes| E[Search valid equivalent forms]
    E --> F[Retain only matching source records]
    F --> G{Result state}
    G -->|none| H[Open Perpusnas ISBN browser check]
    H --> I0{Perpusnas record?}
    I0 -->|Yes| I1[Copy the exact title]
    I0 -->|No| I2[Open WorldCat browser check]
    I2 -->|record| I1
    I2 -->|no record| I4[Use verified physical-book transcription in Mac]
    I1 --> I3[Continue with Mac title search]
    I3 --> L
    I4 --> L
    G -->|different titles| I[Choose using physical title page]
    G -->|several manifestations| J[Match edition, printing, year, publisher, extent]
    G -->|one weak candidate| K[Review conflicts]
    G -->|one supported candidate| L[Final human review]
    I --> L
    J --> L
    K --> L
    L --> M{Output}
    M -->|RIS| N[Download and import]
    M -->|local write| O[Ask Zotero permission]
    O --> P[Check for likely duplicate]
    P -->|duplicate| Q[Report existing item]
    P -->|clear| R[Create reviewed book item]
```

## Failed-record recovery workflow

```mermaid
flowchart TD
    A[No usable ISBN or no automatic catalogue match] --> P[Check Perpusnas first]
    P -->|record| PT[Copy exact title]
    P -->|no record| W[Check WorldCat second]
    W -->|record| PT
    W -->|no record| B
    PT --> MT[Open Mac No ISBN and search by title]
    MT --> B[Read title and copyright pages]
    B --> C[Transcribe title and responsibility]
    B --> D[Transcribe publisher, place, and date]
    B --> E[Keep edition and printing separate]
    B --> F[Transcribe pagination or extent]
    C --> G[Search authoritative catalogues and exact-title results]
    D --> G
    E --> G
    F --> G
    G --> H{Candidate matches the physical book?}
    H -->|No| I[Continue searching or create a minimal manual record]
    H -->|Yes| J[Record provenance and discrepancies]
    J --> K[Check Zotero for a duplicate]
    K --> L[Create or import only after confirmation]
```

Perpusnas is separate from Indonesia OneSearch and is not an automatic
metadata source. Neither Perpusnas nor WorldCat imports a record automatically.
WorldCat RIS import is an exceptional final option after the Mac title-recovery
route.

## Human verification checklist

- Read the physical title page and copyright/colophon page.
- Keep edition and printing/cetakan separate.
- Confirm names and roles; do not turn an editor into an author.
- Compare publisher, place, year, and extent.
- Leave uncertain fields blank and preserve an audit note.
- Search Zotero before creating a new item.
