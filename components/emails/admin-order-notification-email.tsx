import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
  Row,
  Column,
  Link,
} from '@react-email/components'
import * as React from 'react'

interface OrderItem {
  title: string
  quantity: number
  price: number
}

interface AdminOrderNotificationEmailProps {
  orderName: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  items: OrderItem[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  currency: string
  shippingAddress: {
    address: string
    city: string
    postalCode: string
    country: string
  }
  paymentMethod?: string
  orderStatusUrl?: string
}

export const AdminOrderNotificationEmail = ({
  orderName,
  customerName,
  customerEmail,
  customerPhone,
  items,
  subtotal,
  shipping,
  tax,
  total,
  currency,
  shippingAddress,
  paymentMethod,
  orderStatusUrl,
}: AdminOrderNotificationEmailProps) => {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(amount)

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={heading}>🛍️ New Order Received</Heading>
            <Text style={subheading}>Order #{orderName}</Text>
          </Section>

          <Section style={section}>
            <Heading style={sectionTitle}>Customer</Heading>
            <Hr style={divider} />
            <Text style={infoText}><strong>Name:</strong> {customerName}</Text>
            <Text style={infoText}><strong>Email:</strong> {customerEmail}</Text>
            {customerPhone && <Text style={infoText}><strong>Phone:</strong> {customerPhone}</Text>}
          </Section>

          <Section style={section}>
            <Heading style={sectionTitle}>Items Ordered</Heading>
            <Hr style={divider} />
            {items.map((item, index) => (
              <Row key={index} style={itemRow}>
                <Column>
                  <Text style={productTitle}>{item.title}</Text>
                  <Text style={productQty}>Qty: {item.quantity}</Text>
                </Column>
                <Column style={{ textAlign: 'right' as const }}>
                  <Text style={productPrice}>{formatCurrency(item.price * item.quantity)}</Text>
                </Column>
              </Row>
            ))}
            <Hr style={divider} />
            <Row style={totalRow}>
              <Column><Text style={summaryLabel}>Subtotal</Text></Column>
              <Column style={{ textAlign: 'right' as const }}><Text style={summaryValue}>{formatCurrency(subtotal)}</Text></Column>
            </Row>
            <Row style={totalRow}>
              <Column><Text style={summaryLabel}>Shipping</Text></Column>
              <Column style={{ textAlign: 'right' as const }}><Text style={summaryValue}>{formatCurrency(shipping)}</Text></Column>
            </Row>
            {tax > 0 && (
              <Row style={totalRow}>
                <Column><Text style={summaryLabel}>Tax</Text></Column>
                <Column style={{ textAlign: 'right' as const }}><Text style={summaryValue}>{formatCurrency(tax)}</Text></Column>
              </Row>
            )}
            <Row style={finalTotalRow}>
              <Column><Text style={totalLabel}>Total</Text></Column>
              <Column style={{ textAlign: 'right' as const }}><Text style={totalValue}>{formatCurrency(total)}</Text></Column>
            </Row>
          </Section>

          <Section style={section}>
            <Heading style={sectionTitle}>Shipping Address</Heading>
            <Hr style={divider} />
            <Text style={infoText}>
              {shippingAddress.address}<br />
              {shippingAddress.city}, {shippingAddress.postalCode}<br />
              {shippingAddress.country}
            </Text>
          </Section>

          {paymentMethod && (
            <Section style={section}>
              <Text style={infoText}><strong>Payment Method:</strong> {paymentMethod}</Text>
            </Section>
          )}

          {orderStatusUrl && (
            <Section style={{ textAlign: 'center' as const, margin: '20px 0' }}>
              <Link href={orderStatusUrl} style={button}>View Order in Shopify</Link>
            </Section>
          )}

          <Hr style={footerDivider} />
          <Text style={footer}>Rotmina — Admin Notification</Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}
const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 20px',
  borderRadius: '8px',
  maxWidth: '600px',
}
const header = { textAlign: 'center' as const, marginBottom: '30px' }
const heading = { color: '#333', fontSize: '26px', fontWeight: 'bold', margin: '0' }
const subheading = { color: '#888', fontSize: '15px', margin: '5px 0 0' }
const section = { margin: '25px 0' }
const sectionTitle = { fontSize: '17px', fontWeight: 'bold', color: '#333', margin: '0 0 8px' }
const divider = { borderColor: '#eee', margin: '8px 0' }
const infoText = { fontSize: '15px', color: '#555', margin: '4px 0', lineHeight: '22px' }
const itemRow = { margin: '10px 0' }
const productTitle = { fontSize: '15px', fontWeight: 'bold', color: '#333', margin: '0' }
const productQty = { fontSize: '13px', color: '#888', margin: '0' }
const productPrice = { fontSize: '15px', fontWeight: 'bold', color: '#333', margin: '0' }
const totalRow = { margin: '4px 0' }
const summaryLabel = { fontSize: '13px', color: '#888', margin: '0' }
const summaryValue = { fontSize: '13px', color: '#333', fontWeight: 'bold', margin: '0' }
const finalTotalRow = { margin: '12px 0 0', paddingTop: '12px', borderTop: '2px solid #eee' }
const totalLabel = { fontSize: '17px', fontWeight: 'bold', color: '#333', margin: '0' }
const totalValue = { fontSize: '20px', fontWeight: 'bold', color: '#10b981', margin: '0' }
const button = {
  backgroundColor: '#333',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '15px',
  fontWeight: 'bold',
  textDecoration: 'none',
  padding: '10px 22px',
  display: 'inline-block',
}
const footerDivider = { borderColor: '#eee', margin: '25px 0 15px' }
const footer = { color: '#aaa', fontSize: '12px', textAlign: 'center' as const }

export default AdminOrderNotificationEmail
