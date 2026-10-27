// Minimal newline-delimited-JSON framer for the Unix socket IPC between
// server.ts and mcp.ts. TCP/Unix stream sockets don't preserve message
// boundaries, so each side buffers partial reads until a `\n` shows up.
// Byte chunks go through one StringDecoder so a multibyte UTF-8 char split
// across two chunks (e.g. at the 8 KB socket read boundary) stays intact.
import { StringDecoder } from 'node:string_decoder';
export class LineReader {
    onLine;
    buf = '';
    decoder = new StringDecoder('utf8');
    constructor(onLine) {
        this.onLine = onLine;
    }
    push(chunk) {
        this.buf += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
        let idx = this.buf.indexOf('\n');
        while (idx !== -1) {
            const line = this.buf.slice(0, idx);
            this.buf = this.buf.slice(idx + 1);
            if (line.length > 0)
                this.onLine(line);
            idx = this.buf.indexOf('\n');
        }
    }
}
