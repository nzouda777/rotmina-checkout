export type Language = 'en' | 'he'

export const translations = {
  // ─── Header ──────────────────────────────────────────
  header: {
    secureCheckout: {
      en: 'Secure checkout',
      he: 'תשלום מאובטח',
    },
  },

  // ─── Footer ──────────────────────────────────────────
  footer: {
    refundPolicy: {
      en: 'Refund policy',
      he: 'מדיניות החזרים',
    },
    privacyPolicy: {
      en: 'Privacy policy',
      he: 'מדיניות פרטיות',
    },
    termsOfService: {
      en: 'Terms of service',
      he: 'תנאי שימוש',
    },
    secureCheckoutPowered: {
      en: 'Secure checkout powered by Tranzila',
      he: 'תשלום מאובטח מופעל על ידי Tranzila',
    },
  },

  // ─── Checkout Page (breadcrumbs, loading, etc.) ──────
  checkout: {
    cart: {
      en: 'Cart',
      he: 'עגלה',
    },
    information: {
      en: 'Information',
      he: 'פרטים',
    },
    payment: {
      en: 'Payment',
      he: 'תשלום',
    },
    loadingCheckout: {
      en: 'Loading checkout...',
      he: '...טוען את עמוד התשלום',
    },
    checkoutError: {
      en: 'Checkout Error',
      he: 'שגיאה בתשלום',
    },
    processingPayment: {
      en: 'Processing payment...',
      he: '...מעבד תשלום',
    },
    doNotClose: {
      en: 'Please do not close this window',
      he: 'נא לא לסגור את החלון',
    },
  },

  // ─── Customer Form ───────────────────────────────────
  customerForm: {
    contact: {
      en: 'Contact',
      he: 'פרטי קשר',
    },
    email: {
      en: 'Email',
      he: 'אימייל',
    },
    shippingAddress: {
      en: 'Shipping address',
      he: 'כתובת למשלוח',
    },
    firstName: {
      en: 'First name',
      he: 'שם פרטי',
    },
    lastName: {
      en: 'Last name',
      he: 'שם משפחה',
    },
    address: {
      en: 'Address',
      he: 'כתובת',
    },
    city: {
      en: 'City',
      he: 'עיר',
    },
    postalCode: {
      en: 'Postal code (optional)',
      he: 'מיקוד',
    },
    phone: {
      en: 'Phone',
      he: 'טלפון',
    },
    countryRegion: {
      en: 'Country/Region',
      he: 'מדינה/אזור',
    },
    continueToPayment: {
      en: 'Continue to payment',
      he: 'המשך לתשלום',
    },
    // Validation errors
    emailRequired: {
      en: 'Email is required',
      he: 'נדרש אימייל',
    },
    invalidEmail: {
      en: 'Invalid email address',
      he: 'כתובת אימייל לא תקינה',
    },
    firstNameRequired: {
      en: 'First name is required',
      he: 'נדרש שם פרטי',
    },
    lastNameRequired: {
      en: 'Last name is required',
      he: 'נדרש שם משפחה',
    },
    addressRequired: {
      en: 'Address is required',
      he: 'נדרשת כתובת',
    },
    cityRequired: {
      en: 'City is required',
      he: 'נדרשת עיר',
    },
    phoneRequired: {
      en: 'Phone is required',
      he: 'נדרש טלפון',
    },
    // Countries
    israel: {
      en: 'Israel',
      he: 'ישראל',
    },
    unitedStates: {
      en: 'United States',
      he: 'ארצות הברית',
    },
    unitedKingdom: {
      en: 'United Kingdom',
      he: 'בריטניה',
    },
    france: {
      en: 'France',
      he: 'צרפת',
    },
    germany: {
      en: 'Germany',
      he: 'גרמניה',
    },
  },

  // ─── Order Summary ───────────────────────────────────
  orderSummary: {
    title: {
      en: 'Order summary',
      he: 'סיכום הזמנה',
    },
    hideOrderSummary: {
      en: 'Hide order summary',
      he: 'הסתר סיכום הזמנה',
    },
    showOrderSummary: {
      en: 'Show order summary',
      he: 'הצג סיכום הזמנה',
    },
    subtotal: {
      en: 'Subtotal',
      he: 'סכום ביניים',
    },
    shipping: {
      en: 'Shipping',
      he: 'משלוח',
    },
    free: {
      en: 'Free',
      he: 'חינם',
    },
    tax: {
      en: 'Tax',
      he: 'מע"מ',
    },
    giftCard: {
      en: 'Gift card',
      he: 'כרטיס מתנה',
    },
    total: {
      en: 'Total',
      he: 'סה"כ',
    },
  },

  // ─── Gift Card Form ──────────────────────────────────
  giftCardForm: {
    title: {
      en: 'Gift card',
      he: 'כרטיס מתנה',
    },
    placeholder: {
      en: 'Enter gift card code',
      he: 'הזן קוד כרטיס מתנה',
    },
    apply: {
      en: 'Apply',
      he: 'החל',
    },
    checking: {
      en: 'Checking...',
      he: '...בודק',
    },
    applied: {
      en: 'applied',
      he: 'הוחל',
    },
    remainingOnCard: {
      en: 'remaining on card',
      he: 'נותר בכרטיס',
    },
    removeGiftCard: {
      en: 'Remove gift card',
      he: 'הסר כרטיס מתנה',
    },
    giftCardWarning: {
      en: '⚠️ Gift card amount is charged in full immediately and is not included in installment plans.',
      he: '⚠️ סכום כרטיס המתנה מחויב במלואו באופן מיידי ואינו נכלל בתוכניות תשלומים.',
    },
    enterCode: {
      en: 'Please enter a gift card code',
      he: 'נא להזין קוד כרטיס מתנה',
    },
    failedValidation: {
      en: 'Failed to validate gift card. Please try again.',
      he: 'אימות כרטיס המתנה נכשל. נא לנסות שוב.',
    },
  },

  // ─── Payment Form ────────────────────────────────────
  paymentForm: {
    contactLabel: {
      en: 'Contact',
      he: 'איש קשר',
    },
    shipTo: {
      en: 'Ship to',
      he: 'משלוח ל',
    },
    change: {
      en: 'Change',
      he: 'שנה',
    },
    paymentTitle: {
      en: 'Payment',
      he: 'תשלום',
    },
    secureEncrypted: {
      en: 'All transactions are secure and encrypted.',
      he: '.כל העסקאות מאובטחות ומוצפנות',
    },
    creditCard: {
      en: 'Credit Card',
      he: 'כרטיס אשראי',
    },
    creditCardLower: {
      en: 'Credit card',
      he: 'כרטיס אשראי',
    },
    cardNumber: {
      en: 'Card number',
      he: 'מספר כרטיס',
    },
    cardholderName: {
      en: 'Cardholder name',
      he: 'שם בעל הכרטיס',
    },
    expiryDate: {
      en: 'Expiration date (MM/YY)',
      he: '(MM/YY) תאריך תפוגה',
    },
    expiryPlaceholder: {
      en: 'MM / YY',
      he: 'MM / YY',
    },
    securityCode: {
      en: 'Security code',
      he: 'קוד אבטחה',
    },
    cvvPlaceholder: {
      en: 'CVV',
      he: 'CVV',
    },
    // Installments
    fullPayment: {
      en: 'Full payment',
      he: 'תשלום מלא',
    },
    installments: {
      en: 'installments',
      he: 'תשלומים',
    },
    perMonth: {
      en: '/ mo (interest-free)',
      he: '/ חודש (ללא ריבית)',
    },
    interestFreePayments: {
      en: 'interest-free payments of',
      he: 'תשלומים ללא ריבית של',
    },
    giftCardChargedSeparately: {
      en: 'gift card {amount} charged in full separately',
      he: 'כרטיס מתנה {amount} מחויב במלואו בנפרד',
    },
    // Gift card applied notice
    giftCardApplied: {
      en: 'Gift card ****{code} applied: {amount}',
      he: 'כרטיס מתנה ****{code} הוחל: {amount}',
    },
    remainingCharged: {
      en: 'Remaining {amount} will be charged to your credit card.',
      he: 'היתרה של {amount} תחויב בכרטיס האשראי שלך.',
    },
    canSplitInstallments: {
      en: 'You can split this into up to {max} interest-free installments.',
      he: 'ניתן לפצל עד {max} תשלומים ללא ריבית.',
    },
    giftCardCoversAll: {
      en: 'Gift card covers the entire order. No credit card charge needed.',
      he: 'כרטיס המתנה מכסה את כל ההזמנה. אין צורך בחיוב כרטיס אשראי.',
    },
    // Security
    paymentInfoSecure: {
      en: 'Your payment information is secure and encrypted',
      he: 'פרטי התשלום שלך מאובטחים ומוצפנים',
    },
    // Terms
    agreeTerms: {
      en: 'I have read and agree to',
      he: 'קראתי ואני מסכים/ה ל',
    },
    theTerms: {
      en: 'the terms of the agreement',
      he: 'תנאי ההסכם',
    },
    acceptTermsError: {
      en: 'Please accept the terms of the agreement to proceed.',
      he: 'נא לאשר את תנאי ההסכם כדי להמשיך.',
    },
    // Buttons
    returnToInfo: {
      en: 'Return to information',
      he: 'חזרה לפרטים',
    },
    processing: {
      en: 'Processing...',
      he:   'מעבד...',
    },
    payWithBit: {
      en: 'Pay with Bit',
      he: 'שלם עם Bit',
    },
    pay: {
      en: 'Pay',
      he: 'שלם',
    },
    completeOrderGiftCard: {
      en: 'Complete order ({amount} — paid by gift card)',
      he: 'השלם הזמנה ({amount} — שולם בכרטיס מתנה)',
    },
    // Bit payment
    payWithBitTitle: {
      en: 'Pay with Bit',
      he: 'שלם עם Bit',
    },
    bitDescription: {
      en: 'After clicking the button below, a secure payment window will open with a QR code to scan from your Bit app.',
      he: 'לאחר לחיצה על הכפתור למטה, ייפתח חלון תשלום מאובטח עם קוד QR לסריקה מאפליקציית Bit שלך.',
    },
    // Validation
    invalidCardNumber: {
      en: 'Invalid card number',
      he: 'מספר כרטיס לא תקין',
    },
    cardholderRequired: {
      en: 'Cardholder name is required',
      he: 'נדרש שם בעל הכרטיס',
    },
    invalidExpiry: {
      en: 'Invalid expiry date',
      he: 'תאריך תפוגה לא תקין',
    },
    cardExpired: {
      en: 'Card has expired',
      he: 'הכרטיס פג תוקף',
    },
    invalidCvv: {
      en: 'Invalid CVV',
      he: 'CVV לא תקין',
    },
    // Error popup
    paymentDeclined: {
      en: 'Payment Declined',
      he: 'התשלום נדחה',
    },
    tryAgain: {
      en: 'Try Again',
      he: 'נסה שוב',
    },
    verifyCardBalance: {
      en: 'Please verify your card balance or try a different payment method.',
      he: 'נא לבדוק את יתרת הכרטיס או לנסות אמצעי תשלום אחר.',
    },
    returnToStore: {
      en: 'Return to store',
      he: 'חזרה לחנות',
    },
    // 3DS and Iframe
    threeDSVerification: {
      en: '3D Secure Verification',
      he: 'אימות 3D Secure',
    },
    securePayment: {
      en: 'Secure Payment',
      he: 'תשלום מאובטח',
    },
    verifying: {
      en: 'Verifying...',
      he: '...מאמת',
    },
    cancel: {
      en: 'Cancel',
      he: 'ביטול',
    },
    // Terms modal
    termsOfUse: {
      en: 'Terms of Use',
      he: 'תנאי שימוש',
    },
    close: {
      en: 'Close',
      he: 'סגור',
    },
    // Fallback errors
    paymentFailed: {
      en: 'Payment failed',
      he: 'התשלום נכשל',
    },
    paymentProcessingFailed: {
      en: 'Payment processing failed. Please try again.',
      he: 'עיבוד התשלום נכשל. נא לנסות שוב.',
    },
    paymentVerificationFailed: {
      en: 'Payment verification completed but order processing failed. Please contact support.',
      he: 'אימות התשלום הושלם אך עיבוד ההזמנה נכשל. נא ליצור קשר עם התמיכה.',
    },
    paymentDeclinedGeneric: {
      en: 'Payment was declined. Please check your card balance and try again.',
      he: 'התשלום נדחה. נא לבדוק את יתרת הכרטיס ולנסות שוב.',
    },
    paymentDeclinedByBank: {
      en: 'Payment was declined by your bank.',
      he: 'התשלום נדחה על ידי הבנק שלך.',
    },
  },

  // ─── Success Page ────────────────────────────────────
  success: {
    paymentSuccessful: {
      en: 'Payment Successful',
      he: 'התשלום בוצע בהצלחה',
    },
    thankYou: {
      en: 'Thank you for your purchase. Your order has been confirmed.',
      he: 'תודה על הרכישה. ההזמנה שלך אושרה.',
    },
    confirmationCode: {
      en: 'Confirmation Code',
      he: 'קוד אישור',
    },
    giftCardUsed: {
      en: 'Gift Card Used',
      he: 'כרטיס מתנה שומש',
    },
    paidWithGiftCard: {
      en: 'You paid a portion of this order using gift card',
      he: 'שילמת חלק מההזמנה באמצעות כרטיס מתנה',
    },
    remainingBalance: {
      en: 'Remaining Balance',
      he: 'יתרה נותרת',
    },
    yourGiftCard: {
      en: 'Your Gift Card',
      he: 'כרטיס המתנה שלך',
    },
    yourGiftCards: {
      en: 'Your Gift Cards',
      he: 'כרטיסי המתנה שלך',
    },
    giftCardCode: {
      en: 'Gift Card Code',
      he: 'קוד כרטיס מתנה',
    },
    saveCode: {
      en: 'Please save this code carefully. You can use it at checkout to pay for future orders.',
      he: 'נא לשמור את הקוד בקפידה. ניתן להשתמש בו בתשלום עבור הזמנות עתידיות.',
    },
    saveCodes: {
      en: 'Please save these codes carefully. You can use them at checkout to pay for future orders.',
      he: 'נא לשמור את הקודים בקפידה. ניתן להשתמש בהם בתשלום עבור הזמנות עתידיות.',
    },
    confirmationEmailSent: {
      en: 'A confirmation email has been sent to your email address.',
      he: 'אימייל אישור נשלח לכתובת האימייל שלך.',
    },
    copied: {
      en: 'Copied!',
      he: 'הועתק!',
    },
    copy: {
      en: 'Copy',
      he: 'העתק',
    },
  },

  // ─── Error Page ──────────────────────────────────────
  errorPage: {
    paymentFailed: {
      en: 'Payment Failed',
      he: 'התשלום נכשל',
    },
    defaultError: {
      en: 'We were unable to process your payment. Please try again or use a different payment method.',
      he: 'לא הצלחנו לעבד את התשלום שלך. נא לנסות שוב או להשתמש באמצעי תשלום אחר.',
    },
    tryAgain: {
      en: 'Try Again',
      he: 'נסה שוב',
    },
  },

  // ─── Demo Page ───────────────────────────────────────
  demo: {
    badge: {
      en: 'Shopify + Tranzila Payment Integration',
      he: 'אינטגרציית תשלום Shopify + Tranzila',
    },
    heroTitle: {
      en: 'Beautiful Checkout Experience',
      he: 'חווית תשלום מעוצבת',
    },
    heroDescription: {
      en: 'A modern, Shopify-inspired checkout page integrated with Tranzila payment gateway for Israeli merchants.',
      he: 'עמוד תשלום מודרני בהשראת Shopify, משולב עם שער התשלומים Tranzila לעסקים ישראליים.',
    },
    creatingSession: {
      en: 'Creating Session...',
      he: '...יוצר סשן',
    },
    tryDemoCheckout: {
      en: 'Try Demo Checkout',
      he: 'נסה תשלום דמו',
    },
    securePayments: {
      en: 'Secure Payments',
      he: 'תשלומים מאובטחים',
    },
    securePaymentsDesc: {
      en: 'PCI-compliant payment processing through Tranzila with support for all major credit cards.',
      he: 'עיבוד תשלומים תואם PCI דרך Tranzila עם תמיכה בכל כרטיסי האשראי הגדולים.',
    },
    shopifyIntegration: {
      en: 'Shopify Integration',
      he: 'אינטגרציית Shopify',
    },
    shopifyIntegrationDesc: {
      en: 'Seamlessly integrates with your Shopify store as an external payment gateway.',
      he: 'משתלב בצורה חלקה עם חנות ה-Shopify שלך כשער תשלום חיצוני.',
    },
    modernUI: {
      en: 'Modern UI',
      he: 'ממשק מודרני',
    },
    modernUIDesc: {
      en: 'Clean, responsive design inspired by Shopify\'s checkout for a familiar experience.',
      he: 'עיצוב נקי ורספונסיבי בהשראת עמוד התשלום של Shopify לחוויה מוכרת.',
    },
    demoCartItems: {
      en: 'Demo Cart Items',
      he: 'פריטי עגלה לדוגמה',
    },
    total: {
      en: 'Total',
      he: 'סה"כ',
    },
  },
} as const

// Type helper: flatten nested keys to dot notation
type NestedKeys<T, Prefix extends string = ''> = T extends Record<string, unknown>
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends { en: string; he: string }
          ? `${Prefix}${K}`
          : NestedKeys<T[K], `${Prefix}${K}.`>
        : never
    }[keyof T]
  : never

export type TranslationKey = NestedKeys<typeof translations>
