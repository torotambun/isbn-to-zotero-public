from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from .isbn import ISBNValidationError, parse_isbn
from .models import Resolution, SourceRecord, SourceStatus
from .network import HTTPClient
from .reconcile import normalize_text, reconcile
from .sources import configured_source_classes


def _deduplicate(records: list[SourceRecord]) -> list[SourceRecord]:
    output: list[SourceRecord] = []
    seen: set[tuple[str, str]] = set()
    for record in records:
        marker = (record.source, record.source_id or record.source_url)
        if marker not in seen:
            seen.add(marker)
            output.append(record)
    return output


class Resolver:
    def __init__(self, timeout: float = 18.0, source_classes=None):
        self.client = HTTPClient(timeout=timeout)
        source_classes = configured_source_classes() if source_classes is None else source_classes
        self.sources = [source_class(client=self.client) for source_class in source_classes]

    def resolve_one(self, raw_input: str) -> Resolution:
        try:
            info = parse_isbn(raw_input)
        except ISBNValidationError as error:
            message = error.message
            if error.suggestion:
                message += f" A mechanically corrected check digit would be {error.suggestion}, but it was not searched."
            return Resolution(raw_input=str(raw_input), valid=False, validation_message=message)

        result = Resolution(
            raw_input=str(raw_input),
            valid=True,
            isbn10=info.isbn10,
            isbn13=info.isbn13,
            canonical=info.canonical,
            validation_message="Valid ISBN. ISBN-10 and ISBN-13 forms were searched where conversion is defined.",
        )

        records: list[SourceRecord] = []
        statuses: list[SourceStatus] = []
        with ThreadPoolExecutor(max_workers=len(self.sources)) as executor:
            futures = {executor.submit(source.search, info): source for source in self.sources}
            source_order = {source.name: index for index, source in enumerate(self.sources)}
            for future in as_completed(futures):
                source = futures[future]
                try:
                    source_records, status = future.result()
                except Exception as error:  # preserve other source results on an adapter failure
                    source_records = []
                    status = SourceStatus(source.name, False, 0, f"Adapter error: {error}")
                records.extend(source_records)
                statuses.append(status)
        statuses.sort(key=lambda item: source_order.get(item.source, len(source_order)))
        result.source_statuses = statuses
        result.records = _deduplicate(records)
        result.choices = reconcile(result.records, info) if result.records else []

        title_clusters = {choice.title_cluster_id for choice in result.choices}
        if not result.choices:
            result.state = "not_found"
            result.state_message = "No verified record was found. No RIS was generated. Use the assisted fallback search or add a source adapter."
        elif len(title_clusters) > 1:
            result.state = "ambiguous_title"
            result.state_message = "The identifier is linked to multiple titles. Select only after matching the physical title and copyright pages."
        elif len(result.choices) > 1:
            result.state = "multiple_editions"
            result.state_message = "The sources represent multiple printings or editions. Select the physical edition before export."
        elif result.choices[0].confidence == "high":
            result.state = "ready"
            result.state_message = "One edition is supported by multiple records and is ready for RIS export."
            result.recommended_choice_id = result.choices[0].choice_id
        else:
            result.state = "review"
            result.state_message = "One candidate was found, but a physical-book check is still required."
            result.recommended_choice_id = result.choices[0].choice_id
        return result

    def resolve_many(self, values: list[str], workers: int = 4) -> list[Resolution]:
        if not values:
            return []
        output: list[Resolution | None] = [None] * len(values)
        with ThreadPoolExecutor(max_workers=min(max(workers, 1), len(values))) as executor:
            futures = {executor.submit(self.resolve_one, value): index for index, value in enumerate(values)}
            for future in as_completed(futures):
                output[futures[future]] = future.result()
        return [item for item in output if item is not None]

    @staticmethod
    def find_choice(resolution: Resolution, choice_id: str):
        for choice in resolution.choices:
            if choice.choice_id == choice_id:
                return choice
        return None
