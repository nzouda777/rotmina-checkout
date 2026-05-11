import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
} from '@react-email/components'
import * as React from 'react'

interface GiftCardBuyerEmailProps {
  buyerName?: string
  recipientName?: string
  giftCardCode: string
  amount: number
  currency: string
}

export const GiftCardBuyerEmail = ({
  buyerName = 'there',
  recipientName,
  giftCardCode,
  amount,
  currency,
}: GiftCardBuyerEmailProps) => {
  const formattedAmount = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: currency,
  }).format(amount)

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Gift Card Purchase Confirmation</Heading>
          
          <Text style={text}>
            Hi {buyerName},
          </Text>
          
          <Text style={text}>
            Thank you for purchasing a {formattedAmount} gift card{recipientName ? ` for ${recipientName}` : ''}.
          </Text>

          <Section style={detailsContainer}>
            <Text style={boldText}>Gift Card Details:</Text>
            <Text style={text}>
              <strong>Amount:</strong> {formattedAmount}<br/>
              <strong>Code:</strong> {giftCardCode}
            </Text>
            {recipientName && (
              <Text style={helpText}>
                We've also sent an email with the gift card details directly to {recipientName}.
              </Text>
            )}
            <Text style={helpText}>
              Keep this code safe.
            </Text>
          </Section>

          <Hr style={footerDivider} />
          <Text style={footer}>
            rotmina Store
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

const heading = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  textAlign: 'center' as const,
  margin: '0 0 20px',
}

const text = {
  color: '#555',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 10px',
}

const boldText = {
  color: '#333',
  fontSize: '16px',
  fontWeight: 'bold',
  margin: '0 0 10px',
}

const detailsContainer = {
  backgroundColor: '#f9f9f9',
  padding: '20px',
  borderRadius: '4px',
  margin: '20px 0',
}

const helpText = {
  color: '#888',
  fontSize: '14px',
  marginTop: '15px',
}

const footerDivider = {
  borderColor: '#eee',
  margin: '30px 0 20px',
}

const footer = {
  color: '#888',
  fontSize: '12px',
  textAlign: 'center' as const,
}

export default GiftCardBuyerEmail
