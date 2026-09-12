// Synthetic loopback SMTP only. A temporary test CA proves TLS verification without disabling it.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type TLSSocket } from 'node:tls';
export async function smtpFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'daifuku-identity-smtp-')), certPath = join(directory, 'certificate.pem'), keyPath = join(directory, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', timeout: 10000 });
  const cert = await readFile(certPath, 'utf8'), key = await readFile(keyPath, 'utf8'), messages: string[] = [], sockets = new Set<TLSSocket>();
  const server = createServer({ cert, key, minVersion: 'TLSv1.2' }, (socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => undefined);
    socket.setEncoding('utf8'); socket.write('220 localhost synthetic SMTP\r\n');
    let pending = '', data = false, body = '';
    socket.on('data', (chunk: string) => {
      pending += chunk;
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n'), line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data) {
          if (line !== '.') { body += line.replace(/^\.\./, '.') + '\r\n'; continue; }
          messages.push(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))); body = ''; data = false; socket.write('250 accepted synthetic message\r\n');
        } else if (/^EHLO /i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) socket.write('235 synthetic authentication accepted\r\n');
        else if (/^MAIL FROM:/i.test(line) || /^RSET/i.test(line)) socket.write('250 ok\r\n');
        else if (/^RCPT TO:/i.test(line)) socket.write(/@example\.(com|test)>/i.test(line) ? '250 ok\r\n' : '550 only synthetic recipients accepted\r\n');
        else if (/^DATA$/i.test(line)) { data = true; socket.write('354 end with dot\r\n'); }
        else if (/^QUIT$/i.test(line)) { socket.end('221 bye\r\n'); }
        else socket.write('500 unsupported synthetic command\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing SMTP address');
  return { options: { host: '127.0.0.1', port: address.port, secure: true, user: 'synthetic-user', password: 'synthetic-password', from: 'mail@example.com', tlsCa: cert }, messages,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); },
  };
}
