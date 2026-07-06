import fs from 'fs'
import { resolve } from 'path'
import { sendMorningReceipt, detectPaymentMethod } from '../lib/morning'

// Load environment variables manually without dotenv
const envContent = fs.readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    let value = match[2] || ''
    if (value.startsWith('"') && value.endsWith('"')) value = value.substring(1, value.length - 1)
    value = value.split(' #')[0].trim()
    process.env[match[1]] = value
  }
})

async function runTest(lang: 'he' | 'en') {
  console.log(`\n🚀 Starting Morning API test flow — lang: ${lang}`)

  const mockCustomer = {
    email: 'rodriguenzouda35@gmail.com',
    firstName: 'Test',
    lastName: 'Card',
  }

  const mockCart = {
    total: 150.50,
    currency: 'ILS',
    items: [
      { title: 'Test Product 1', quantity: 1, price: 100.00 },
      { title: 'Test Product 2', quantity: 2, price: 25.25 },
    ],
  }

  const mockRawResponse = {
    payment_method: 'test_card',
    Response: '000',
    ConfirmationCode: 'MOCK-123456',
    ccno: '5430050220380520',
  }

  const paymentMethod = detectPaymentMethod(mockRawResponse)
  console.log(`💳 Detected payment method: ${paymentMethod}`)

  const emailContent = lang === 'he' ? '!תתחדשי' : 'Wear it well!'
  console.log(`✉️  Email content (remarks + content field): "${emailContent}"`)

  const params = {
    customerEmail: mockCustomer.email,
    customerName: `${mockCustomer.firstName} ${mockCustomer.lastName}`,
    amount: mockCart.total,
    currency: mockCart.currency,
    paymentMethod,
    lang,
    items: mockCart.items.map(item => ({
      description: item.title,
      quantity: item.quantity,
      price: item.price,
    })),
  }

  console.log('📝 Sending Morning receipt with params:', JSON.stringify(params, null, 2))

  try {
    const result = await sendMorningReceipt(params)
    if (result.success) {
      console.log('✅ Morning receipt created successfully!')
      console.log(`📄 Document ID: ${result.documentId}`)
      console.log(`🔗 Document URL: ${result.documentUrl}`)
    } else {
      console.error('❌ Failed to create Morning receipt:', result.error)
    }
  } catch (err: any) {
    console.error('❌ Exception during Morning receipt creation:', err.message)
  }
}

async function main() {
  await runTest('en') // email content: "Wear it well!"
  await runTest('he') // email content: "!תתחדשי"
}

main()
