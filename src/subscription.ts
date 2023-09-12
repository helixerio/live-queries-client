import { applyPatch, type Operation } from 'fast-json-patch';
import { type CustomEventDataType, type CustomEventType, SSE, SSEOptionsMethod } from './sse';

interface LiveQueryResponse<T> {
	data: T;
	errors: { message: string }[] | null;
	patch?: Operation[];
}

export function subscribe<T>({
	url,
	headers,
	payload,
	withCredentials,
	onData
}: {
	url: string;
	headers?: Record<string, string>;
	payload: string;
	withCredentials?: boolean;
	onData: (data: T | null, errors: { message: string }[] | null) => void;
}): () => void {
	let lastValue: T | null = null;

	const source = new SSE(url.toString(), {
		method: SSEOptionsMethod.POST,
		payload,
		withCredentials,
		headers: {
			...(headers ?? {}),
			'X-GQL-Transport': 'live-query',
			'Content-Type': 'application/json'
		}
	});

	source.addEventListener('next', (event: CustomEventType) => {
		const dataEvent = event as CustomEventDataType;
		const payload = JSON.parse(dataEvent.data) as LiveQueryResponse<T>;

		let value: T | null;

		if (payload.patch && lastValue) {
			value = applyPatch(lastValue, payload.patch).newDocument as T;
		} else if (payload.data !== null) {
			value = payload.data;
		} else {
			value = null;
		}

		onData(value, payload.errors);
		lastValue = value;
	});

	source.addEventListener('error', () => {
		source.close();
		onData(null, [{ message: 'connection closed' }]);
	});

	source.stream();

	return () => source.close();
}
