// Генерация самоподписанных SSL сертификатов
const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const certsDir = path.resolve(__dirname, '../../../certs');

if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
}

const attrs = [{ name: 'commonName', value: 'localhost' }];

const ext = [
  { name: 'basicConstraints', cA: true },
  { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
  { name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip: '192.168.199.197' },
    { type: 7, ip: '172.18.0.1' },
  ]},
];

async function generate() {
  console.log('🔑 Генерация самоподписанных SSL сертификатов...\n');

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: ext,
  });

  const certPath = path.join(certsDir, 'cert.pem');
  const keyPath = path.join(certsDir, 'key.pem');

  // selfsigned может вернуть объект с полями private/public/cert или строку
  const cert = pems.cert || pems.cert;
  const privateKey = pems.private || pems.private;

  fs.writeFileSync(certPath, cert);
  fs.writeFileSync(keyPath, privateKey);

  console.log('✅ Сертификаты созданы:');
  console.log('   📄 ' + certPath);
  console.log('   🔐 ' + keyPath);
  console.log('\n📋 Домены:');
  console.log('   • localhost');
  console.log('   • 127.0.0.1');
  console.log('   • 192.168.199.197');
  console.log('   • 172.18.0.1');
  console.log('\n⚠️  Браузер покажет предупреждение — это нормально для самоподписанных сертификатов');
  console.log('   Нажмите "Дополнительно" → "Перейти на сайт"');
}

generate().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
