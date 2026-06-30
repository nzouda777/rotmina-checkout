import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
  Img,
  Row,
  Column,
  Link,
} from '@react-email/components'
import * as React from 'react'

interface OrderItem {
  title: string
  quantity: number
  price: number
  image?: string
}

interface OrderConfirmationEmailProps {
  orderName: string
  customerName: string
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
  orderStatusUrl?: string
}

export const OrderConfirmationEmail = ({
  orderName,
  customerName,
  items,
  subtotal,
  shipping,
  tax,
  total,
  currency,
  shippingAddress,
  orderStatusUrl,
}: OrderConfirmationEmailProps) => {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: currency,
    }).format(amount)

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={heading}>Order Confirmation</Heading>
            <Text style={subheading}>Order #{orderName}</Text>
          </Section>

          <Text style={text}>Hi {customerName},</Text>
          <Text style={text}>
            Thank you for your purchase! We've received your order and are getting it ready.
          </Text>

          <Section style={section}>
            <Heading style={sectionTitle}>Order Summary</Heading>
            <Hr style={divider} />
            {items.map((item, index) => (
              <Row key={index} style={itemRow}>
                {item.image && (
                  <Column style={{ width: '60px' }}>
                    <Img
                      src={item.image}
                      width="60"
                      height="60"
                      alt={item.title}
                      style={productImage}
                    />
                  </Column>
                )}
                <Column style={{ paddingLeft: '15px' }}>
                  <Text style={productTitle}>{item.title}</Text>
                  <Text style={productQuantity}>Qty: {item.quantity}</Text>
                </Column>
                <Column style={{ textAlign: 'right' as const }}>
                  <Text style={productPrice}>{formatCurrency(item.price * item.quantity)}</Text>
                </Column>
              </Row>
            ))}

            <Hr style={divider} />
            
            <Row style={totalRow}>
              <Column>
                <Text style={summaryLabel}>Subtotal</Text>
              </Column>
              <Column style={{ textAlign: 'right' as const }}>
                <Text style={summaryValue}>{formatCurrency(subtotal)}</Text>
              </Column>
            </Row>
            <Row style={totalRow}>
              <Column>
                <Text style={summaryLabel}>Shipping</Text>
              </Column>
              <Column style={{ textAlign: 'right' as const }}>
                <Text style={summaryValue}>{formatCurrency(shipping)}</Text>
              </Column>
            </Row>
            {tax > 0 && (
              <Row style={totalRow}>
                <Column>
                  <Text style={summaryLabel}>Tax</Text>
                </Column>
                <Column style={{ textAlign: 'right' as const }}>
                  <Text style={summaryValue}>{formatCurrency(tax)}</Text>
                </Column>
              </Row>
            )}
            <Row style={finalTotalRow}>
              <Column>
                <Text style={totalLabel}>Total</Text>
              </Column>
              <Column style={{ textAlign: 'right' as const }}>
                <Text style={totalValue}>{formatCurrency(total)}</Text>
              </Column>
            </Row>
          </Section>

          <Section style={section}>
            <Heading style={sectionTitle}>Shipping Address</Heading>
            <Hr style={divider} />
            <Text style={addressText}>
              {customerName}<br />
              {shippingAddress.address}<br />
              {shippingAddress.city}, {shippingAddress.postalCode}<br />
              {shippingAddress.country}
            </Text>
          </Section>

          {/* {orderStatusUrl && (
            <Section style={buttonContainer}>
              <Link href={orderStatusUrl} style={button}>
                Track Your Order
              </Link>
            </Section>
          )} */}

          <Hr style={footerDivider} />
          <Text style={footer}>
            rotmina Store<br />
            Thank you for shopping with us!
          </Text>
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
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
  maxWidth: '600px',
}

const header = {
  textAlign: 'center' as const,
  marginBottom: '30px',
}

const heading = {
  color: '#333',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0',
}

const subheading = {
  color: '#888',
  fontSize: '16px',
  margin: '5px 0 0',
}

const text = {
  color: '#555',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 10px',
}

const section = {
  margin: '30px 0',
}

const sectionTitle = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#333',
  margin: '0 0 10px',
}

const divider = {
  borderColor: '#eee',
  margin: '10px 0',
}

const itemRow = {
  margin: '15px 0',
}

const productImage = {
  borderRadius: '4px',
  border: '1px solid #eee',
}

const productTitle = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#333',
  margin: '0',
}

const productQuantity = {
  fontSize: '14px',
  color: '#888',
  margin: '0',
}

const productPrice = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#333',
  margin: '0',
}

const totalRow = {
  margin: '5px 0',
}

const summaryLabel = {
  fontSize: '14px',
  color: '#888',
}

const summaryValue = {
  fontSize: '14px',
  color: '#333',
  fontWeight: 'bold',
}

const finalTotalRow = {
  margin: '15px 0 0',
  paddingTop: '15px',
  borderTop: '2px solid #eee',
}

const totalLabel = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#333',
}

const totalValue = {
  fontSize: '22px',
  fontWeight: 'bold',
  color: '#8B74E8', // green
}

const addressText = {
  fontSize: '14px',
  lineHeight: '20px',
  color: '#555',
}

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '30px 0',
}

const button = {
  backgroundColor: '#8B74E8',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
}

const footerDivider = {
  borderColor: '#eee',
  margin: '30px 0 20px',
}

const footer = {
  color: '#888',
  fontSize: '12px',
  textAlign: 'center' as const,
  lineHeight: '18px',
}

export default OrderConfirmationEmail
