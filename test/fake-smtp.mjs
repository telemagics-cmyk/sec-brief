// 시험용 가짜 SMTP 서버 (node --test 대상 아님: 파일 이름이 *.test.mjs 가 아님)
import { createServer } from 'node:net';

/**
 * @param {{mails?: object[], failAuth?: () => boolean}} opts 받은 메일을 쌓을 배열, 로그인을 거절할지
 * @returns {Promise<{port: number, close: () => void}>}
 */
export async function startFakeSmtp({ mails = [], failAuth = () => false } = {}) {
  const server = createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    let buf = '';
    let inData = false;
    let data = '';
    let mail = { from: '', to: [], auth: '' };
    const send = (l) => sock.write(`${l}\r\n`);
    send('220 fake.smtp ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            mails.push({ ...mail, data });
            data = '';
            mail = { from: '', to: [], auth: mail.auth };
            send('250 2.0.0 OK queued');
          } else data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-fake.smtp\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('HELO')) send('250 fake');
        else if (cmd.startsWith('AUTH')) {
          mail.auth = Buffer.from(line.split(' ')[2] || '', 'base64').toString('utf8').split('\0').slice(1).join(':');
          send(failAuth() ? '535 5.7.8 Username and Password not accepted' : '235 2.7.0 Accepted');
        } else if (cmd.startsWith('MAIL FROM')) {
          mail.from = line.slice(10);
          send('250 OK');
        } else if (cmd.startsWith('RCPT TO')) {
          mail.to.push(line.slice(8));
          send('250 OK');
        } else if (cmd === 'DATA') {
          inData = true;
          send('354 go ahead');
        } else if (cmd === 'QUIT') {
          send('221 bye');
          sock.end();
        } else send('250 OK');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // 단정문이 실패해 close 를 못 불러도 시험 프로세스가 멈추지 않게
  server.unref();
  return { port: server.address().port, close: () => server.close() };
}
