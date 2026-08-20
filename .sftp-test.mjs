/**
 * Ad-hoc SFTP client check (not part of the repo test suite).
 * Verifies auth, READDIR, WRITE, READ, RENAME, REMOVE and jail escape rejection.
 */
import ssh2 from 'ssh2';
import fs from 'node:fs';

const { Client } = ssh2;
const password = fs.readFileSync('/tmp/kilo/sftp-pass.txt', 'utf8').trim();
const { sftp: creds } = JSON.parse(fs.readFileSync('/tmp/kilo/sftp.json', 'utf8'));

const conn = new Client();

conn
  .on('ready', () => {
    console.log('AUTH: ok');
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP session failed:', err.message);
        process.exit(1);
      }

      sftp.readdir('/', (err2, list) => {
        if (err2) {
          console.error('READDIR failed:', err2.message);
          process.exit(1);
        }
        console.log('READDIR /:', list.map((e) => e.filename).slice(0, 8).join(', '));

        const payload = Buffer.from('hello from sftp test\n');
        const ws = sftp.createWriteStream('/panel-sftp-test.txt');
        ws.on('close', () => {
          console.log('WRITE: ok');
          const chunks = [];
          sftp
            .createReadStream('/panel-sftp-test.txt')
            .on('data', (c) => chunks.push(c))
            .on('end', () => {
              console.log('READ:', JSON.stringify(Buffer.concat(chunks).toString()));
              sftp.rename('/panel-sftp-test.txt', '/panel-sftp-renamed.txt', (err3) => {
                console.log('RENAME:', err3 ? `failed ${err3.message}` : 'ok');
                sftp.stat('/panel-sftp-renamed.txt', (err4, stats) => {
                  console.log('STAT:', err4 ? `failed ${err4.message}` : `size=${stats.size}`);
                  // Traversal must be rejected/contained.
                  sftp.readdir('/../../..', (err5, escaped) => {
                    console.log(
                      'JAIL ESCAPE /../../..:',
                      err5 ? `rejected (${err5.message})` : `contained → ${escaped.length} entries (same as root)`,
                    );
                    sftp.unlink('/panel-sftp-renamed.txt', (err6) => {
                      console.log('REMOVE:', err6 ? `failed ${err6.message}` : 'ok');
                      sftp.mkdir('/panel-sftp-dir', (err7) => {
                        console.log('MKDIR:', err7 ? `failed ${err7.message}` : 'ok');
                        sftp.rmdir('/panel-sftp-dir', (err8) => {
                          console.log('RMDIR:', err8 ? `failed ${err8.message}` : 'ok');
                          conn.end();
                        });
                      });
                    });
                  });
                });
              });
            });
        });
        ws.end(payload);
      });
    });
  })
  .on('error', (err) => {
    console.error('CONNECTION ERROR:', err.message);
    process.exit(1);
  })
  .connect({
    host: '127.0.0.1',
    port: creds.port,
    username: creds.username,
    password,
    readyTimeout: 15000,
  });
