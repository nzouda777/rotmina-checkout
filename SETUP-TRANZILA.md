# Tranzila Hosted Fields Setup Guide

## 🔧 Configuration Required

Your Tranzila hosted fields integration is complete but needs configuration. Follow these steps:

### 1. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required for hosted fields
TRANZILA_TERMINAL=fxprotmina
NEXT_PUBLIC_TRANZILA_TERMINAL=fxprotmina
NEXT_PUBLIC_TRANZILA_TEST_MODE=true

# For production (get from Tranzila dashboard)
TRANZILA_TERMINAL_PASSWORD=your_actual_password
TRANZILA_APP_KEY=your_actual_app_key  
TRANZILA_SECRET=your_actual_secret
```

### 2. Get Tranzila Credentials

1. **Terminal Name**: Already configured (`fxprotmina`)
2. **Terminal Password**: 
   - Login to Tranzila dashboard
   - Go to Terminal Settings → Security
   - Copy your terminal password
3. **App Key & Secret** (for production):
   - Contact Tranzila support: 073-222-4444
   - Request API V2 access for hosted fields

### 3. Test the Integration

```bash
# Test your configuration
node scripts/test-tranzila-hosted-fields.js

# Start development server
npm run dev
```

## 🐛 Troubleshooting Handshake Errors

If you still get handshake errors:

### Error: "Invalid request, TranzilaPW"
**Cause**: Missing or incorrect terminal password
**Solution**: 
```bash
# Set correct password
TRANZILA_TERMINAL_PASSWORD=your_correct_password
```

### Error: "Unsupported method"  
**Cause**: API V2 not properly configured
**Solution**:
```bash
# Set API credentials
TRANZILA_APP_KEY=your_app_key
TRANZILA_SECRET=your_secret
```

### Error: "Terminal not found"
**Cause**: Incorrect terminal name
**Solution**:
```bash
# Verify terminal name
TRANZILA_TERMINAL=your_actual_terminal
```

## 🎯 Test Scenarios

Once configured, test these scenarios:

1. **Card Payment Flow**
   - Enter test card: 5430050220380520
   - Verify hosted fields load
   - Check 3DS flow

2. **Bit Payment Flow** 
   - Select Bit payment method
   - Verify QR code appears
   - Test mobile redirect

3. **Error Handling**
   - Invalid card number
   - Expired card
   - Insufficient funds

4. **Installments**
   - Test different installment counts
   - Verify calculations

## 🚀 Production Deployment

For production:

1. Set `NEXT_PUBLIC_TRANZILA_TEST_MODE=false`
2. Use real terminal credentials
3. Enable HTTPS
4. Test with real cards

## 📞 Support

If issues persist:
- **Tranzila Support**: 073-222-4444
- **Technical Docs**: Check `skill.md` in project root
- **Test Script**: `node scripts/test-tranzila-hosted-fields.js`

## ✅ Success Indicators

Your integration is working when:
- ✅ Handshake token generates successfully
- ✅ Hosted fields load in browser
- ✅ Test card payment completes
- ✅ Shopify order is created
- ✅ Confirmation email is sent
