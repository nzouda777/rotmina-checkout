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
  const customerName = 'Test Card';
  const customerEmail = 'rodriguenzouda35@gmail.com';
  const amount = 150.50;
  const morningPaymentType = 3; // Credit Card
  const lang = 'en';

  const items = [
    { description: 'Test Product 1', quantity: 1, price: 100.00 },
    { description: 'Test Product 2', quantity: 2, price: 25.25 },
  ];

  const formatILS = (n) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n);

  const itemRows = items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee;color:#333;font-size:15px;font-weight:bold;">
        ${item.description}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #eee;color:#888;font-size:14px;text-align:center;">
        x${item.quantity}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #eee;color:#333;font-size:15px;font-weight:bold;text-align:right;">
        ${formatILS(item.price * item.quantity)}
      </td>
    </tr>`).join('');

  const remarks = lang === 'he' ? '!תתחדשי' : 'Wear it well!';

  const emailBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Ubuntu,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f9fc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.05);padding:40px;max-width:600px;">

        <!-- Header -->
        <tr>
          <td style="text-align:center;padding-bottom:30px;">
            <h1 style="margin:0;color:#333;font-size:28px;font-weight:bold;">Order Confirmation</h1>
            <p style="margin:5px 0 0;color:#888;font-size:16px;">Receipt #TEST-${Date.now().toString().slice(-6)}</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding-bottom:10px;">
            <p style="margin:0 0 10px;color:#555;font-size:16px;line-height:24px;">Hi ${customerName},</p>
            <p style="margin:0 0 10px;color:#555;font-size:16px;line-height:24px;">
              Thank you for your purchase! We've received your order and are getting it ready.
            </p>
          </td>
        </tr>

        <!-- Order Summary -->
        <tr>
          <td style="padding-top:20px;">
            <h2 style="margin:0 0 10px;font-size:18px;font-weight:bold;color:#333;">Order Summary</h2>
            <hr style="border:none;border-top:1px solid #eee;margin:10px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${itemRows}
              <!-- Total -->
              <tr>
                <td colspan="2" style="padding:15px 0 5px;font-size:18px;font-weight:bold;color:#333;border-top:2px solid #eee;">
                  Total
                </td>
                <td style="padding:15px 0 5px;text-align:right;font-size:22px;font-weight:bold;color:#10b981;border-top:2px solid #eee;">
                  ${formatILS(amount)}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Remarks -->
        <tr>
          <td style="padding-top:24px;text-align:center;">
            <p style="margin:0;color:#10b981;font-size:18px;font-weight:bold;letter-spacing:0.5px;">
              ${remarks}
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:24px;text-align:center;border-top:1px solid #eee;margin-top:24px;">
            <p style="margin:0;color:#888;font-size:12px;line-height:18px;">
              rotmina Store<br>
              Thank you for shopping with us!
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const documentPayload = {
    type: 400, // Receipt
    date: payDate,
    dueDate: payDate,
    lang,
    currency: 'ILS',
    vatType: 0,
    amount: amount,
    client: {
      name: customerName,
      emails: [customerEmail],
      add: true,
    },
    email: {
      to: [{ email: customerEmail }],
      lang,
      subject: `Order Confirmation - rotmina Store`,
      remarks,
      body: emailBody,
    },
    income: items.map(item => ({
      catalogNum: '',
      description: item.description,
      quantity: item.quantity,
      price: item.price,
      currency: 'ILS',
      vatType: 0,
    })),
    payment: [
      {
        type: morningPaymentType,
        price: amount,
        currency: 'ILS',
        date: payDate,
      },
    ],
    remarks,
    footer: 'rotmina Store — Thank you for shopping with us!',
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
