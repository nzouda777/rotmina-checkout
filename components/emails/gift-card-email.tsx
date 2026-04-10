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
} from '@react-email/components'
import * as React from 'react'

interface GiftCardEmailProps {
  recipientName?: string
  senderName?: string
  giftCardCode: string
  amount: number
  currency: string
  message?: string
}

export const GiftCardEmail = ({
  recipientName = 'there',
  senderName,
  giftCardCode,
  amount,
  currency,
  message,
}: GiftCardEmailProps) => {
  const formattedAmount = new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: currency,
  }).format(amount)

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>You received a Gift Card! 🎁</Heading>
          
          <Text style={text}>
            Hi {recipientName},
          </Text>
          
          <Text style={text}>
            {senderName ? `${senderName} has sent you` : 'You have received'} a gift card worth {formattedAmount} for your next purchase.
          </Text>

          {message && (
            <Section style={messageBox}>
              <Text style={messageQuote}>&quot;{message}&quot;</Text>
            </Section>
          )}

          <Section style={giftCardContainer}>
            <Text style={giftCardAmount}>{formattedAmount}</Text>
            <Hr style={divider} />
            <Text style={codeLabel}>Your Gift Card Code:</Text>
            <Text style={giftCardCodeText}>{giftCardCode}</Text>
          </Section>

          <Text style={helpText}>
            To use this gift card, simply enter the code at checkout.
          </Text>

          <Hr style={footerDivider} />
          <Text style={footer}>
            Rotmani Store
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

const messageBox = {
  backgroundColor: '#f9f9f9',
  padding: '20px',
  borderRadius: '4px',
  margin: '20px 0',
  borderLeft: '4px solid #10b981', // green
}

const messageQuote = {
  color: '#333',
  fontSize: '16px',
  fontStyle: 'italic',
  margin: '0',
}

const giftCardContainer = {
  backgroundColor: '#10b981', // green background
  color: '#ffffff',
  borderRadius: '8px',
  padding: '30px',
  textAlign: 'center' as const,
  margin: '30px 0',
}

const giftCardAmount = {
  fontSize: '36px',
  fontWeight: 'bold',
  margin: '0 0 15px',
  color: '#ffffff',
}

const divider = {
  borderColor: 'rgba(255, 255, 255, 0.3)',
  margin: '20px 0',
}

const codeLabel = {
  fontSize: '14px',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  margin: '0 0 10px',
  color: 'rgba(255, 255, 255, 0.9)',
}

const giftCardCodeText = {
  fontSize: '24px',
  fontWeight: 'bold',
  letterSpacing: '3px',
  margin: '0',
  color: '#ffffff',
}

const helpText = {
  color: '#888',
  fontSize: '14px',
  textAlign: 'center' as const,
  margin: '20px 0 0',
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

export default GiftCardEmail
