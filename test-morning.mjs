import fs from 'fs';
import path from 'path';

// Parse .env manually
const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    // Handle inline comments
    value = value.split(' #')[0].trim();
    envVars[match[1]] = value;
  }
});

const MORNING_API_KEY = envVars.MORNING_API_KEY || '';
const MORNING_API_SECRET = envVars.MORNING_API_SECRET || '';

async function testAuth(envName, baseUrl) {
  console.log(`[MORNING] Testing ${envName} authentication...`);
  try {
    const authRes = await fetch(`${baseUrl}/account/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: MORNING_API_KEY, secret: MORNING_API_SECRET }),
    });

    if (!authRes.ok) {
      console.log(`❌ ${envName} failed: ${await authRes.text()}`);
      return null;
    }
    const { token } = await authRes.json();
    console.log(`✅ ${envName} authentication successful!`);
    return { token, baseUrl };
  } catch (err) {
    console.error(`❌ ${envName} exception:`, err.message);
    return null;
  }
}

async function runTest() {
  const sandbox = await testAuth('Sandbox', 'https://sandbox.d.greeninvoice.co.il/api/v1');
  const prod = await testAuth('Production', 'https://api.greeninvoice.co.il/api/v1');

  const validEnv = sandbox || prod;

  if (!validEnv) {
    console.log('❌ Could not authenticate with either Sandbox or Production.');
    return;
  }

  const { token, baseUrl } = validEnv;
  console.log(`\n🚀 Proceeding with receipt creation on ${baseUrl}...`);

  const payDate = new Date().toISOString().split('T')[0];
  const amount = 150.50;
  const morningPaymentType = 3; // Credit Card

  const documentPayload = {
    type: 400, // Receipt
    date: payDate,
    dueDate: payDate,
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    amount: amount,
    client: {
      name: 'Test Card User',
      emails: ['Liorger535@gmail.com'], // Updated to requested email
      add: true,
    },
    email: {
      to: [
        {
          email: 'Liorger535@gmail.com',
        }
      ],
      lang: 'he'
    },
    income: [
      {
        catalogNum: '',
        description: 'Test Product 1',
        quantity: 1,
        price: 100.00,
        currency: 'ILS',
        vatType: 0,
      },
      {
        catalogNum: '',
        description: 'Test Product 2',
        quantity: 2,
        price: 25.25,
        currency: 'ILS',
        vatType: 0,
      }
    ],
    payment: [
      {
        type: morningPaymentType,
        price: amount,
        currency: 'ILS',
        date: payDate,
      },
    ],
    remarks: 'Test created from CLI using test card flow',
    footer: '',
  };

  const docRes = await fetch(`${baseUrl}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(documentPayload),
  });

  if (!docRes.ok) {
    console.error(`❌ Document creation failed (${docRes.status}): ${await docRes.text()}`);
    return;
  }

  const result = await docRes.json();
  const documentId = result.id || result._id;
  let documentUrl = result.url || result.shareUrl || (documentId ? `${baseUrl}/documents/${documentId}` : undefined);
  if (documentUrl && typeof documentUrl === 'object') {
    documentUrl = documentUrl.he || documentUrl.en || JSON.stringify(documentUrl);
  }

  console.log(`[MORNING] ✅ Receipt created successfully!`);
  console.log(`📄 Document ID: ${documentId}`);
  console.log(`🔗 Document URL: ${documentUrl}`);
}

runTest();
