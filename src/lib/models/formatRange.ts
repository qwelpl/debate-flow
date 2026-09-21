// Inline formatting ranges for a box's text.
// A range is a half-open interval [start, end) of character offsets.
// Each inline format keeps its own list of ranges.

export type Range = [number, number];

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strike';
export const INLINE_FORMATS: InlineFormat[] = ['bold', 'italic', 'underline', 'strike'];

export type FormatRanges = Partial<Record<InlineFormat, Range[]>>;

// sort, drop empty/invalid, merge overlapping or touching
export function normalizeRanges(ranges: Range[]): Range[] {
	const clean = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
	const out: Range[] = [];
	for (const [a, b] of clean) {
		const last = out[out.length - 1];
		if (last && a <= last[1]) {
			last[1] = Math.max(last[1], b);
		} else {
			out.push([a, b]);
		}
	}
	return out;
}

function isFullyCovered(ranges: Range[], start: number, end: number): boolean {
	return normalizeRanges(ranges).some(([a, b]) => a <= start && b >= end);
}

function subtract(ranges: Range[], start: number, end: number): Range[] {
	const out: Range[] = [];
	for (const [a, b] of ranges) {
		if (a < start) out.push([a, Math.min(b, start)]);
		if (b > end) out.push([Math.max(a, end), b]);
	}
	return normalizeRanges(out);
}

// toggle a format over [start, end): if the whole selection already has it, remove it, else add it
export function toggleRange(ranges: Range[], start: number, end: number): Range[] {
	if (start >= end) return normalizeRanges(ranges);
	if (isFullyCovered(ranges, start, end)) {
		return subtract(ranges, start, end);
	}
	return normalizeRanges([...ranges, [start, end]]);
}

// shift ranges after a single text edit, diffing old vs new content
export function shiftRanges(oldStr: string, newStr: string, ranges: Range[]): Range[] {
	if (ranges.length === 0) return ranges;
	if (oldStr === newStr) return ranges;

	const maxPrefix = Math.min(oldStr.length, newStr.length);
	let p = 0;
	while (p < maxPrefix && oldStr[p] === newStr[p]) p++;

	let s = 0;
	while (s < maxPrefix - p && oldStr[oldStr.length - 1 - s] === newStr[newStr.length - 1 - s]) {
		s++;
	}

	const oldEnd = oldStr.length - s; // [p, oldEnd) of oldStr was replaced
	const delta = newStr.length - oldStr.length;

	const shift = (x: number): number => {
		if (x <= p) return x;
		if (x >= oldEnd) return x + delta;
		return p; // endpoint fell inside the edited region
	};

	return normalizeRanges(ranges.map(([a, b]) => [shift(a), shift(b)]));
}

// ---- FormatRanges (all formats) helpers ----

export function hasAnyRanges(formats: FormatRanges | undefined): boolean {
	if (formats == null) return false;
	return INLINE_FORMATS.some((f) => (formats[f]?.length ?? 0) > 0);
}

export function toggleFormat(
	formats: FormatRanges | undefined,
	format: InlineFormat,
	start: number,
	end: number
): FormatRanges {
	const next: FormatRanges = { ...formats };
	const toggled = toggleRange(next[format] ?? [], start, end);
	if (toggled.length > 0) {
		next[format] = toggled;
	} else {
		delete next[format];
	}
	return next;
}

export function shiftFormatRanges(
	oldStr: string,
	newStr: string,
	formats: FormatRanges | undefined
): FormatRanges | undefined {
	if (!hasAnyRanges(formats)) return formats;
	const next: FormatRanges = {};
	for (const f of INLINE_FORMATS) {
		const ranges = formats?.[f];
		if (ranges && ranges.length > 0) {
			const shifted = shiftRanges(oldStr, newStr, ranges);
			if (shifted.length > 0) next[f] = shifted;
		}
	}
	return next;
}

export type Segment = { text: string } & Record<InlineFormat, boolean>;

// split content into contiguous segments, each tagged with which formats are active.
// `whole` marks formats that apply to the entire cell (legacy whole-box flags).
export function toSegments(
	content: string,
	formats: FormatRanges | undefined,
	whole: Partial<Record<InlineFormat, boolean>> = {}
): Segment[] {
	const len = content.length;
	if (len === 0) return [];

	// boundary points where any format starts or ends
	const points = new Set<number>([0, len]);
	for (const f of INLINE_FORMATS) {
		for (const [a, b] of normalizeRanges(formats?.[f] ?? [])) {
			if (a > 0 && a < len) points.add(a);
			if (b > 0 && b < len) points.add(b);
		}
	}
	const sorted = [...points].sort((x, y) => x - y);

	const active = (f: InlineFormat, pos: number): boolean =>
		(whole[f] ?? false) || (formats?.[f] ?? []).some(([a, b]) => a <= pos && pos < b);

	const segs: Segment[] = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (b <= a) continue;
		segs.push({
			text: content.slice(a, b),
			bold: active('bold', a),
			italic: active('italic', a),
			underline: active('underline', a),
			strike: active('strike', a)
		});
	}
	return segs;
}
