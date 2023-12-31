const FIELD_SEPARATOR = ':';

enum XHRStates {
	INITIALIZING = -1,
	CONNECTING = 0,
	OPEN = 1,
	CLOSED = 2
}

export type CustomEventReadyStateChangeType = CustomEvent & {
	readyState: XHRStates;
};

export type CustomEventErrorType = CustomEvent & {
	reason: Event;
};

export type CustomEventDataType = CustomEvent & {
	data: any; // Represents a JSON object
	id: string;
};

export enum SSEOptionsMethod {
	GET = 'GET',
	POST = 'POST'
}

export type CustomEventType =
	| CustomEvent
	| CustomEventDataType
	| CustomEventReadyStateChangeType
	| CustomEventErrorType;

export interface SSEOptions {
	/**
	 * A dictionary of key-value pairs.
	 * Like: { "Content-type": "application/json" }
	 */
	headers?: { [key: string]: string };

	/**
	 * The XMLHttpRequest.withCredentials property is a boolean value
	 * that indicates whether or not cross-site Access-Control requests
	 * should be made using credentials such as cookies,
	 * authorization headers or TLS client certificates.
	 * Setting withCredentials has no effect on same-site requests.
	 */
	withCredentials?: boolean;

	/**
	 * The HTTP method (currently only GET and POST are supported)
	 * [Required].
	 */
	method: SSEOptionsMethod;

	/**
	 * The JSON stringified payload representing the request body.
	 */
	payload?: string;
}

export type Callback = (e: CustomEventType) => void;

export class SSE {
	private listeners: { [key: string]: Callback[] } = {};
	private readyState: XHRStates = XHRStates.INITIALIZING;
	private chunk = '';
	private progress = 0;
	private xhr?: XMLHttpRequest;

	constructor(private url: string, private options: SSEOptions) {
		if (!url) {
			throw new Error('url cannot be null');
		}

		if (!options || !options.method) {
			throw new Error('Method is mandatory in `options`');
		}
	}

	public addEventListener(type: string, listener: Callback): void {
		this.listeners[type] = this.listeners[type] || [];

		if (this.listeners[type].indexOf(listener) === -1) {
			this.listeners[type].push(listener);
		}
	}

	public removeEventListener(type: string, listener: Callback) {
		if (!this.listeners[type]) {
			return;
		}

		const filteredListeners = this.listeners[type].filter((lis) => lis !== listener);
		if (!filteredListeners.length) {
			delete this.listeners[type];
		} else {
			this.listeners[type] = filteredListeners;
		}
	}

	public stream() {
		this._setReadyState(XHRStates.CONNECTING);

		const xhr = new XMLHttpRequest();
		xhr.onreadystatechange = (evt) => this._checkStreamClosed(evt);
		xhr.onprogress = (evt) => this._onStreamProgress(evt);
		xhr.onload = (evt) => this._onStreamLoaded(evt);
		xhr.onerror = (evt) => this._onStreamFailure(evt);
		xhr.onabort = (evt) => this._onStreamAbort(evt);

		xhr.open(this.options.method, this.url);

		xhr.setRequestHeader('Accept', 'text/event-stream');
		for (const header in this.options.headers) {
			xhr.setRequestHeader(header, this.options.headers[header]);
		}

		xhr.withCredentials = !!this.options.withCredentials;
		xhr.send(this.options.payload);
		this.xhr = xhr;
	}

	close() {
		if (this.readyState === XHRStates.CLOSED) {
			return;
		}

		this.xhr?.abort();
		this.xhr = undefined;
		this._setReadyState(XHRStates.CLOSED);
	}

	private dispatchEvent(e: CustomEventType) {
		if (!e) {
			return true;
		}

		const onHandler = 'on' + e.type;
		if (this.hasOwnProperty(onHandler)) {
			(this as any)[onHandler].call(this, e);
			if (e.defaultPrevented) {
				return false;
			}
		}

		if (this.listeners[e.type]) {
			return this.listeners[e.type].every((callback: Callback) => {
				callback(e);
				return !e.defaultPrevented;
			});
		}

		return true;
	}

	private _setReadyState(state: XHRStates) {
		const event = new CustomEvent('readystatechange') as CustomEventReadyStateChangeType;
		event.readyState = state;
		this.readyState = state;
		this.dispatchEvent(event);
	}

	_onStreamFailure(e: Event) {
		const failureEvent = new CustomEvent('error') as CustomEventErrorType;
		failureEvent.reason = e;
		this.dispatchEvent(failureEvent);
		this.close();
	}

	_onStreamAbort(e: Event) {
		this.dispatchEvent(new CustomEvent('abort'));
		this.close();
	}

	_onStreamProgress(e: Event) {
		if (!this.xhr) {
			return;
		}

		if (this.xhr.status !== 200) {
			this._onStreamFailure(e);
			return;
		}

		if (this.readyState === XHRStates.CONNECTING) {
			const openEvent = new CustomEvent('open');
			this.dispatchEvent(openEvent);
			this._setReadyState(XHRStates.OPEN);
		}

		const data = this.xhr.responseText.substring(this.progress);
		this.progress += data.length;

		data.split(/(\r\n|\r|\n){2}/g).forEach((part: string) => {
			if (part.trim().length === 0) {
				const chunkEvent = this._parseEventChunk(this.chunk.trim());
				if (chunkEvent !== null) {
					this.dispatchEvent(chunkEvent);
					this.chunk = '';
				}
			} else {
				this.chunk += part;
			}
		});
	}

	private _onStreamLoaded(e: Event) {
		this._onStreamProgress(e);

		const streamData = this._parseEventChunk(this.chunk);
		if (streamData !== null) {
			// Parse the last chunk.
			this.dispatchEvent(streamData);
			this.chunk = '';
		}
	}

	/**
	 * Parse a received SSE event chunk into a constructed event object.
	 */
	private _parseEventChunk(chunk: string) {
		if (!chunk || !chunk.length) {
			return null;
		}

		const e: any = { id: null, retry: null, data: '', event: 'message' };

		chunk.split(/\n|\r\n|\r/).forEach((line: string) => {
			line = line.trimEnd();
			const index = line.indexOf(FIELD_SEPARATOR);
			if (index <= 0) {
				// Line was either empty, or started with a separator and is a comment.
				// Either way, ignore.
				return;
			}

			const field = line.substring(0, index);
			if (!(field in e)) {
				return;
			}

			const value = line.substring(index + 1).trimLeft();
			if (field === 'data') {
				e[field] += value;
			} else {
				e[field] = value;
			}
		});

		const event = new CustomEvent(e.event) as CustomEventDataType;
		event.data = e.data;
		event.id = e.id;
		return event;
	}

	private _checkStreamClosed(e: Event) {
		if (!this.xhr) {
			return;
		}

		if (this.xhr.readyState === XMLHttpRequest.DONE) {
			this._setReadyState(XHRStates.CLOSED);
		}
	}
}
