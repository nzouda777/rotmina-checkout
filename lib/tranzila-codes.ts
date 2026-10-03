/**
 * Tranzila response codes — official list.
 *
 * Source: https://docs.tranzila.com/docs/payments-and-billing/transaction-response-codes
 *   (SHVA codes 001–998, 3DS codes 900–930) and the API reference
 *   https://docs.tranzila.com/docs/payments-and-billing/tranzila-api-3ds/complete
 *   (application error codes 20000+). Fetched 2026-10-03.
 *
 * NOTE: these are SHVA (Israeli clearing) codes, NOT the generic ISO-8583 bank
 * codes — e.g. 051 means "Missing vector 1 file" here, not "insufficient funds".
 */

type L = { en: string; he: string }

export type TranzilaCodeCategory =
  | 'bank_decline'      // issuer / card company refused
  | 'card_details'      // customer typed something wrong
  | 'authentication'    // 3D Secure
  | 'cancelled'         // customer cancelled
  | 'configuration'     // terminal / request set-up on our side
  | 'technical'         // temporary gateway / network problem

export interface TranzilaCodeInfo {
  code: string
  /** Exact wording from Tranzila's documentation (English or Hebrew). */
  official?: string
  category: TranzilaCodeCategory
  headline: L
  explanation: L
  action: L
}

/** Official messages, verbatim. */
export const TRANZILA_OFFICIAL_CODES: Record<string, string> = {
  "000": "Transaction approved.",
  "001": "Blocked confiscate card. Please check and enter the credit number again.",
  "002": "Stolen confiscate card. Please check and enter the credit number again.",
  "003": "Contact credit company to approve the transaction.",
  "004": "Refusal. Please contact the card owner to check the reason with his credit company.",
  "005": "Forged confiscate card.",
  "006": "Incorrect identity number or CVV.",
  "007": "Invalid cavv/ucaf.",
  "008": "Invalid avs.",
  "009": "Unsuccessful communication.",
  "010": "Partial confirmation",
  "011": "דחה עסקה : חוסר בנקודות/כוכבים/מיילים/הטבה אחרת",
  "012": "Unauthorized card for this terminal.",
  "013": "קוד יתרה שגוי",
  "014": "כרטיס לא משויך לרשת",
  "015": "Expired card. Please check the expiration date again.",
  "016": "Unauthorized currency.",
  "017": "Unauthorized credit type for this transaction.",
  "026": "Wrong ID number. Please check the ID number again.",
  "041": "ישנה חובת יציאה לשאילתא בגין תקרה בלבד לעסקה עם פרמטר J2",
  "042": "ישנה חובת יציאה לשאילתא לא רק בגין תקרה, לעסקה עם פרמטר J2",
  "051": "Missing vector 1 file.",
  "052": "Missing vector 4 file.",
  "053": "Missing vector 6 file.",
  "055": "Missing vector 11 file.",
  "056": "Missing vector 12 file.",
  "057": "Missing vector 15 file.",
  "058": "Missing vector 18 file.",
  "059": "Missing vector 31 file.",
  "060": "Missing vector 34 file.",
  "061": "Missing vector 41 file.",
  "062": "Missing vector 44 file.",
  "063": "Missing vector 64 file.",
  "064": "Missing vector 80 file.",
  "065": "Missing vector 81 file.",
  "066": "Missing vector 82 file.",
  "067": "Missing vector 83 file.",
  "068": "Missing vector 90 file.",
  "069": "Missing vector 91 file.",
  "070": "Missing vector 92 file.",
  "071": "Missing vector 93 file.",
  "073": "Missing PARAM_3_1 file.",
  "074": "Missing PARAM_3_2 file.",
  "075": "Missing PARAM_3_3 file.",
  "076": "Missing PARAM_3_4 file.",
  "077": "Missing PARAM_361 file.",
  "078": "Missing PARAM_363 file.",
  "079": "Missing PARAM_364 file.",
  "080": "Missing PARAM_61 file.",
  "081": "Missing PARAM_62 file.",
  "082": "Missing PARAM_63 file.",
  "083": "Missing CEIL_41 file.",
  "084": "Missing CEIL_42 file.",
  "085": "Missing CEIL_43 file.",
  "086": "Missing CEIL_44 file.",
  "087": "Missing DATA file.",
  "088": "Missing JENR file.",
  "089": "Missing Start file.",
  "101": "חסרה כניסה בוקטור 1",
  "103": "חסרה כניסה בוקטור 4",
  "104": "חסרה כניסה בוקטור 6",
  "106": "חסרה כניסה בוקטור 11",
  "107": "חסרה כניסה בוקטור 12",
  "108": "חסרה כניסה בוקטור 15",
  "110": "חסרה כניסה בוקטור 18",
  "111": "חסרה כניסה בוקטור 31",
  "112": "חסרה כניסה בוקטור 34",
  "113": "חסרה כניסה בוקטור 41",
  "114": "חסרה כניסה בוקטור 44",
  "116": "חסרה כניסה בוקטור 64",
  "117": "חסרה כניסה בוקטור 81",
  "118": "חסרה כניסה בוקטור 82",
  "119": "חסרה כניסה בוקטור 83",
  "120": "חסרה כניסה בוקטור 90",
  "121": "חסרה כניסה בוקטור 91",
  "122": "חסרה כניסה בוקטור 92",
  "123": "חסרה כניסה בוקטור 93",
  "141": "Terminal not authorized to clear transaction brand",
  "142": "חסרה כניסה מתאימה בקובץ פרמטרים 3.3",
  "143": "חסרה כניסה בקובץ תחומי מועדון 3.6.1",
  "144": "חסרה כניסה בקובץ תחומי מועדון 3.6.3",
  "145": "חסרה כניסה בקובץ תחומי מועדון 3.6.4",
  "146": "חסרה כניסה בקובץ תקרות לכרטיסי PL 4.1",
  "147": "חסרה כניסה בקובץ תקרות לכרטיסים ישראלים שאינם PL שיטה 0 4.2",
  "148": "חסרה כניסה בקובץ תקרות לכרטיסים ישראלים שאינם PL שיטה 1 4.3",
  "149": "חסרה כניסה בקובץ תקרות לכרטיסי תייר 4.4",
  "150": "חסרה כניסה בקובץ כרטיסים תקפים - ישראכרט",
  "151": "חסרה כניסה בקובץ כרטיסים תקפים - כאל",
  "152": "חסרה כניסה בקובץ כרטיסים תקפים - מנפיק עתידי",
  "182": "Vector 4 values error.",
  "183": "Vector 6/12 values error.",
  "186": "Vector 18 values error.",
  "187": "Vector 34 values error.",
  "188": "Vector 64 values error.",
  "190": "Vector 90 values error.",
  "191": "נתונים לא תקינים בוקטור הרשאות מנפיק",
  "192": "נתונים לא ולידים בסט הפרמטרים",
  "193": "נתונים לא ולידים בקובץ פרמטרים ברמת מסוף",
  "300": "אין הרשאה לסוג עסקה - הרשאת סולק",
  "301": "אין הרשאה למטבע - הרשאת סולק - אין אישור סולק למטבע ISO. למסוף אין הרשאה מחברת האשראי הסולקת לעסקאות במט\"ח.",
  "303": "אין הרשאת סולק לביצוע עסקה כאשר הכרטיס לא נוכח - למסוף אין אישור לעסקה טלפונית.",
  "304": "אין הרשאה לאשראי - הרשאת סולק - כרטיס לא רשאי לבצע במסוף זה או אין אישור לעסקה כזאת.",
  "308": "אין הרשאה להצמדה - הרשאת סולק",
  "309": "אין הרשאה לסולק לאשראי במועד קבוע",
  "310": "אין הרשאה להקלדת מספר אישור מראש",
  "311": "אין הרשאה לבצע עסקאות לקוד שרות 587 - למסוף אין אישור לכרטיס עם קוד השרות 085.",
  "312": "אין הרשאת סולק לאשראי דחוי",
  "313": "אין הרשאת סולק להטבות",
  "314": "אין הרשאת סולק למבצעים",
  "315": "אין הרשאת סולק לקוד מבצע ספציפי",
  "316": "אין הרשאת סולק לעסקת טעינה",
  "317": "אין הרשאת סולק לטעינה/פריקה בקוד אמצעי התשלום בשילוב קוד מטבע",
  "318": "אין הרשאת סולק למטבע בסוג אשראי זה - אין אישור סולק למטבע ISO.",
  "319": "אין הרשאת סולק לטיפ",
  "341": "אין הרשאה לעסקה - הרשאת מנפיק",
  "342": "אין הרשאה למטבע - הרשאת מנפיק - אין אישור למותג למטבע ISO.",
  "343": "אין הרשאת מנפיק לביצוע עסקה כאשר הכרטיס לא נוכח",
  "344": "אין הרשאה לאשראי - הרשאת מנפיק - כרטיס לא רשאי לבצע עסקה עם סוג אשראי זה.",
  "348": "אין הרשאה לביצוע אישור בקשה יזומה ע\"י קמעונאי",
  "349": "אין הרשאה מתאימה לביצוע בקשה לאישור ללא עסקה J5",
  "350": "אין הרשאת מנפיק להטבות",
  "351": "אין הרשאת מנפיק לאשראי דחוי",
  "352": "אין הרשאת מנפיק לעסקת טעינה",
  "353": "אין הרשאת מנפיק לטעינה/פריקה בקוד אמצעי התשלום",
  "354": "אין הרשאת מנפיק למטבע בסוג אשראי זה - אין אישור למותג למטבע ISO.",
  "381": "אין הרשאה לבצע עסקת contactless מעל סכום מרבי",
  "382": "במסוף המוגדר כשרות עצמי ניתן לבצע רק עסקאות בשירות עצמי",
  "384": "מסוף מוגדר כרב-ספק /מוטב - חסר מספר ספק/מוטב",
  "385": "במסוף המוגדר כמסוף סחר אלקטרוני חובה להעביר eci",
  "401": "מספר התשלומים גדול מערך שדה מספר תשלומים מקסימלי",
  "402": "מספר התשלומים קטן מערך שדה מספר תשלומים מינימלי",
  "403": "סכום העסקה קטן מערך שדה סכום מינמלי לתשלום !!!",
  "404": "לא הוזן שדה מספר תשלומים",
  "405": "חסר נתון סכום תשלום ראשון /קבוע",
  "406": "סה\"כ סכום העסקה שונה מסכום תשלום ראשון + סכום תשלום קבוע * מספר תשלומים – שגיאה בתשלומים - סכום עסקה צריך להיות שווה תשלום ראשון + )תשלום קבוע כפול מס' תשלומים(- עסקה בתשלומים שהוכנסו ערכים שגויים. פנה למפיץ התוכנה.",
  "407": "Invalid channel 2",
  "408": "ערוץ 2  קצר  מ 37-תווים - אורך הפס המגנטי קצר מידי. – הוכנס לקובץ הקלט אורך פס מגנטי לא תקין",
  "410": "דחיה מסיבת  dcode",
  "414": "בעסקה עם חיוב בתאריך קבוע הוכנס תאריך מאוחר משנה מבצוע העיסקה",
  "415": "הוזנו נתונים לא תקינים",
  "416": "Invalid expiry date",
  "417": "Invalid terminal number",
  "418": "חסרים פרמטרים חיוניים",
  "419": "שגיאה בהעברת מאפיין clientInputPan",
  "420": "מספר כרטיס לא ולידי -במצב של הזנת ערוץ 2 בעסקה ללא כרטיס נוכח",
  "421": "שגיאה כללי- נתונים לא ולידים",
  "422": "שגיאה בבנית מסר  ISO",
  "424": "שדה לא נומרי",
  "425": "Duplicate record",
  "426": "הסכום הוגדל לאחר ביצוע בדיקות אשראית",
  "428": "חסר קוד שרות בכרטיס",
  "429": "כרטיס אינו תקף לפי קובץ כרטיסים תקפים",
  "431": "General failure.",
  "432": "אין הראשה להעברת כרטיס דרך קורא מגנטי",
  "433": "חיוב להעביר ב - PinPad",
  "434": "אסור  להעביר כרטיס במכשיר ה- PinPad",
  "435": "המכשיר לא מוגדר להעברת כרטיס מגנטי CTL",
  "436": "המכשיר לא מוגדר להעברת כרטיס EMV CTL",
  "439": "אין הרשאה לסוג אשראי לפי סוג עסקה",
  "440": "כרטיס תייר אינו מורשה לסוג אשראי זה",
  "441": "אין הרשאה לביצוע סוג עסקה - כרטיס קיים בוקטור 80",
  "442": "אין לבצע Stand-in לאימות אישור לסולק זה",
  "443": "לא ניתן לבצע עסקת ביטול  - כרטיס לא נמצא בקובץ תנועות הקיים במסוף",
  "445": "בכרטיס חיוב מיידי ניתן לבצע אשראי חיוב מיידי בלבד",
  "447": "Wrong credit card number.",
  "448": "Address (City, Street, House number & Zip code) is necessary.",
  "449": "Zip code is necessary.",
  "450": "קוד מבצע מחוץ לתחום, צ\"ל בתחום 1-12",
  "451": "שגיאה במהלך בנית רשומת עסקה",
  "452": "בעסקה טעינה/פריקה/בירור יתרה חיוב להזין שדה קוד אמצעי תשלום",
  "453": "אין אפשרות לבטל עסקת פריקה 7.9.3",
  "455": "לא ניתן לבצע עסקת חיוב מאולצת כאשר נדרשת בקשה לאישור (למעט תקרות)",
  "456": "כרטיס נמצא בקובץ תנועות עם קוד תשובה 'החרם כרטיס'",
  "457": "בכרטיס חיוב מיידי מותרת עסקת חיוב רגילה/זיכוי/ביטול",
  "458": "קוד מועדון לא בתחום",
  "470": "בעסקת הו\"ק סכום התשלומים גבוה משדה סכום העסקה",
  "471": "בעסקת הו\"ק מספר תשלום תורן גדול מסה\"כ מספר התשלומים",
  "472": "בעסקת חיוב עם מזומן חיוב להזין סכום במזומן",
  "473": "בעסקת חיוב עם מזומן סכום המזומן צריך להיות קטן מסכום העסקה",
  "474": "עסקת איתחול בהוראת קבע מחייבת פרמטר J5",
  "475": "עסקת ה\"ק מחייבת אחד מהשדות :מספר תשלומים או סכום כולל",
  "476": "עסקת תורן בהוראת קבע מחייבת שדה מספר תשלום",
  "477": "עסקת תורן בהוראת קבע מחייבת מספר מזהה של עסקת איתחול",
  "478": "עסקת תורן בהוראת קבע מחייבת מספר אישור של עסקת איתחול",
  "479": "עסקת תורן בהוראת קבע מחייבת שדות תאריך וזמן עסקת איתחול",
  "480": "חסר שדה מאשר עסקת מקור",
  "481": "חסר שדה מספר יחידות כאשר העסקה מתבצעת בקוד אמצעי תשלום השונה ממטבע",
  "482": "בכרטיס נטען מותרת עסקת חיוב רגילה/זיכוי/ביטול/פריקה/טעינה/בירור יתרה",
  "483": "עסקה עם כרטיס דלק במסוף דלק חיוב להזין מספר רכב",
  "484": "מספר רכב המוקלד שונה ממספר הרכב הצרוב ע\"ג הפס המגנטי/מספר בנק שונה מ-012/ספרות שמאליות של מספר הסניף שונה מ- 44",
  "485": "מספר רכב קצר  מ- 6 ספרות /שונה ממספר הרכב המופיע ע\"ג ערוץ 2 (פוזיציה 34 בערוץ 2) כרטיס מאפיין דלק של לאומי קארד",
  "486": "ישנה חובת הקלדת קריאת מונה (פוזיציה 30 בערוץ 2)  כרטיס מאפיין דלק של לאומי קארד",
  "487": "רק במסוף המוגדר כדלק דו שלבי ניתן להשתמש בעדכון אובליגו",
  "489": "בכרטיס דלקן מותרת עסקת חיוב רגילה בלבד (עסקת ביטול אסורה)",
  "490": "בכרטיסי דלק/דלקן/דלק מועדון ניתן לבצע עסקאות רק במסופי דלק",
  "491": "עסקה הכוללת המרה חייבת להכיל את כל השדות conversion_amount_06, conversion_rate_09, conversion_currency_51",
  "492": "אין המרה על עסקאות שקל /דולר",
  "493": "בעסקה הכוללת הטבה חיוב שיהיו רק אחד מהשדות הבאים: סכום הנחה/מספר יחידות/ % ההנחה",
  "494": "מספר מסוף שונה",
  "495": "אין הרשאת  fallback",
  "496": "לא ניתן להצמיד אשראי השונה מאשראי קרדיט/תשלומים",
  "497": "לא ניתן להצמיד לדולר/מדד במטבע השונה משקל",
  "498": "כרטיס ישראכרט מקומי הספרטור  צ\"ל בפוזיציה 18",
  "500": "העסקה הופסקה ע\"י המשתמש",
  "504": "חוסר התאמה בין שדה מקור נתוני הכרטיס לשדה מספר כרטיס",
  "505": "ערך לא חוקי בשדה סוג עסקה",
  "506": "ערך לא חוקי בשדה eci",
  "507": "סכום העסקה בפועל גבוה מהסכום המאושר",
  "509": "שגיאה במהלך כתיבה לקובץ תנועות",
  "512": "לא ניתן להכניס אישור שהתקבל ממענה קולי לעסקה זו",
  "551": "מסר תשובה אינו מתאים למסר הבקשה",
  "552": "שגיאה בשדה 55",
  "553": "התקבלה שגיאה מהטנדם",
  "554": "במסר התשובה חסר שדה mcc_18",
  "555": "במסר התשובה חסר שדה response_code_25",
  "556": "במסר התשובה חסר שדה rrn_37",
  "557": "במסר התשובה חסר שדה comp_retailer_num_42",
  "558": "במסר התשובה חסר שדה auth_code_43",
  "559": "במסר התשובה חסר שדה f39_response_39",
  "560": "במסר התשובה חסר שדה authorization_no_38",
  "561": "במסר התשובה חסר / ריק שדה additional_data_48.solek_auth_no",
  "562": "במסר התשובה חסר אחד מהשדות conversion_amount_06, conversion_rate_09, conversion_currency_51",
  "563": "ערך השדה אינו מתאים למספרי האישור שהתקבלו auth_code_43",
  "564": "במסר התשובה חסר/ריק שדה additional_amounts54.cashback_amount",
  "565": "אי-התאמה בין שדה 25 לשדה 43",
  "566": "במסוף המוגדר כתומך בדלק דו-שלבי יש חובה להחזיר שדות 90,119",
  "567": "שדות 25,127 לא תקינים במסר עידכון אובליגו במסוף המוגדר כדלק דו-שלבי",
  "700": "עסקה נדחתה ע\"י מכשיר PinPad",
  "701": "שגיאה במכשיר pinpad",
  "702": "יציאת com לא תקינה",
  "703": "עסקה נכשלה",
  "704": "עסקה בוטלה",
  "705": "עסקה הופסקה ע\"י המשתמש",
  "706": "זמן המתנה ארוך מדי",
  "707": "משתמש הוציא כרטיס לפני סיום ביצוע העסקה",
  "708": "PINPAD_UserRetriesExceeded",
  "709": "PINPAD_PINPadTimeout",
  "710": "תקלת תקשורת עם מכשיר",
  "711": "PINPAD_PINPadMessageError",
  "712": "PINPAD_PINPadNotInitialized",
  "713": "PINPAD_PINPadCardReadError",
  "714": "PINPAD_ReaderTimeout",
  "715": "PINPAD_ReaderCommsError",
  "716": "PINPAD_ReaderMessageError",
  "717": "PINPAD_HostMessageError",
  "718": "PINPAD_HostConfigError",
  "719": "PINPAD_HostKeyError",
  "720": "PINPAD_HostConnectError",
  "721": "PINPAD_HostTransmitError",
  "722": "PINPAD_HostReceiveError",
  "723": "PINPAD_HostTimeout",
  "724": "PINVerificationNotSupportedByCard",
  "725": "PINVerificationFailed",
  "726": "שגיאה בקליטת קובץ config.xml",
  "730": "מכשיר אישר עסקה בניגוד להחלטת אשראית",
  "731": "Card number not found. Please enter the credit card number again.",
  "800": "Transaction canceled.",
  "900": "Transaction failed at 3D Secure authentication stage.",
  "901": "Card authentication failed.",
  "902": "Unrecognized device.",
  "903": "Unsupported device.",
  "904": "Authentication frequency limit exceeded.",
  "905": "Expired card.",
  "906": "Invalid card number.",
  "907": "Invalid transaction.",
  "908": "Card registration record not found.",
  "909": "Security failure.",
  "910": "Stolen card.",
  "911": "Suspected fraud.",
  "912": "Transaction not authorized for the cardholder.",
  "913": "Cardholder not enrolled in the service.",
  "914": "ACS transaction timeout expired.",
  "915": "Low trust level.",
  "916": "Medium trust level.",
  "917": "High trust level.",
  "918": "Very high trust level.",
  "919": "Maximum ACS challenge count exceeded.",
  "920": "Non-payment transaction not supported.",
  "921": "3RI transaction not supported.",
  "922": "Technical issue at ACS.",
  "923": "Decoupled authentication required by ACS but not requested by 3DS requestor.",
  "924": "Maximum decoupled 3DS requestor expiry time exceeded.",
  "925": "Decoupled authentication did not have sufficient time to authenticate the cardholder.",
  "926": "Authentication was attempted but not completed by the cardholder.",
  "927": "Card authentication cancelled by user.",
  "928": "Card authentication cancelled by user.",
  "930": "Authentication was attempted but not completed by the cardholder.",
  "951": "PayPal protocol error.",
  "952": "PayPal payment was not completed. The browser was closed or the communication with the browser was disconnected.",
  "954": "PayPal payment failed.",
  "997": "General failure.",
  "998": "Transactions file failure. Please contact Tranzila support.",
  "20000": "Authentication failed",
  "20001": "Invalid JSON Format",
  "20002": "Authorization failed",
  "20003": "Invalid JSON Schema",
  "20004": "JSON Schema mismatch",
  "20111": "Provided token check failure",
  "20112": "Original transaction not found",
  "21100": "Transaction index is not equal to original transaction index",
  "21101": "Provided index was empty",
  "22100": "Authorization number is not equal to the transaction value",
  "22101": "Empty authorization number",
  "22103": "Invalid DCdisable",
}

// ── What the merchant should understand / do, per category ────────────────────

const CATEGORY_TEXT: Record<TranzilaCodeCategory, { explanation: L; action: L }> = {
  bank_decline: {
    explanation: {
      en: 'The card company or the issuing bank refused the charge. Nothing is wrong on our side.',
      he: 'חברת האשראי או הבנק המנפיק סירבו לחיוב. אין תקלה מצדנו.',
    },
    action: {
      en: 'The customer should contact their card company, or pay with another card or Bit.',
      he: 'על הלקוח לפנות לחברת האשראי, או לשלם בכרטיס אחר או ב-Bit.',
    },
  },
  card_details: {
    explanation: {
      en: 'The card details entered by the customer were rejected.',
      he: 'פרטי הכרטיס שהזין הלקוח נדחו.',
    },
    action: {
      en: 'The customer should re-enter the card details carefully and try again.',
      he: 'על הלקוח להזין שוב את פרטי הכרטיס בקפידה ולנסות שוב.',
    },
  },
  authentication: {
    explanation: {
      en: 'The bank\'s 3D Secure identity check (SMS code / banking app) did not succeed. No money was taken.',
      he: 'אימות הזהות 3D Secure של הבנק (קוד SMS / אפליקציית הבנק) לא הצליח. לא בוצע חיוב.',
    },
    action: {
      en: 'The customer can retry and complete the bank verification, or pay with Bit.',
      he: 'הלקוח יכול לנסות שוב ולהשלים את אימות הבנק, או לשלם ב-Bit.',
    },
  },
  cancelled: {
    explanation: {
      en: 'The customer cancelled the payment. No money was taken.',
      he: 'הלקוח ביטל את התשלום. לא בוצע חיוב.',
    },
    action: {
      en: 'No action needed unless the customer contacts you.',
      he: 'אין צורך בפעולה אלא אם הלקוח פונה.',
    },
  },
  configuration: {
    explanation: {
      en: 'Not the customer\'s fault: the Tranzila terminal or the request sent by our checkout is not set up for this transaction.',
      he: 'לא באשמת הלקוח: מסוף טרנזילה או הבקשה שנשלחה מהצ\'קאאוט אינם מוגדרים לעסקה זו.',
    },
    action: {
      en: 'Send this code to Tranzila support (or to the developer) — other customers will hit the same error until it is fixed.',
      he: 'יש להעביר את הקוד לתמיכת טרנזילה (או למפתח) — לקוחות נוספים ייתקלו באותה שגיאה עד לתיקון.',
    },
  },
  technical: {
    explanation: {
      en: 'Temporary technical problem at Tranzila, SHVA or the bank.',
      he: 'תקלה טכנית זמנית בטרנזילה, בשב"א או בבנק.',
    },
    action: {
      en: 'The customer can try again in a few minutes. If it keeps happening, contact Tranzila support.',
      he: 'הלקוח יכול לנסות שוב בעוד מספר דקות. אם זה חוזר, יש לפנות לתמיכת טרנזילה.',
    },
  },
}

// ── Plain-language headline + category for the codes customers actually hit ──
// Anything not listed here falls back to the official wording + a range-based category.

const KNOWN: Record<string, [TranzilaCodeCategory, L, Partial<{ explanation: L; action: L }>?]> = {
  '001': ['bank_decline', { en: 'Card blocked', he: 'כרטיס חסום' }],
  '002': ['bank_decline', { en: 'Card reported stolen', he: 'כרטיס מדווח כגנוב' }, {
    action: { en: 'Do not retry with this card. Be cautious if the same customer keeps trying different cards.', he: 'אין לנסות שוב עם כרטיס זה. יש לנהוג בזהירות אם אותו לקוח מנסה כרטיסים שונים.' } }],
  '003': ['bank_decline', { en: 'Card company asks the cardholder to call', he: 'חברת האשראי מבקשת שבעל הכרטיס יתקשר' }, {
    action: { en: 'The cardholder must call their card company to approve the purchase, then retry.', he: 'על בעל הכרטיס להתקשר לחברת האשראי כדי לאשר את הרכישה, ואז לנסות שוב.' } }],
  '004': ['bank_decline', { en: 'Refused by the card company', he: 'סירוב של חברת האשראי' }],
  '005': ['bank_decline', { en: 'Card flagged as forged', he: 'כרטיס מסומן כמזויף' }],
  '006': ['card_details', { en: 'Wrong ID number or CVV', he: 'תעודת זהות או CVV שגויים' }],
  '007': ['authentication', { en: '3D Secure data invalid (CAVV/UCAF)', he: 'נתוני 3D Secure לא תקינים (CAVV/UCAF)' }],
  '009': ['technical', { en: 'Communication failure with the card company', he: 'תקשורת לא הצליחה מול חברת האשראי' }],
  '010': ['bank_decline', { en: 'Only partially approved', he: 'אישור חלקי בלבד' }],
  '012': ['configuration', { en: 'This card type is not enabled on our terminal', he: 'סוג כרטיס זה אינו מורשה במסוף שלנו' }, {
    explanation: { en: 'Our Tranzila terminal is not authorised for this card brand (often Amex, Diners or foreign cards).', he: 'מסוף טרנזילה שלנו אינו מורשה למותג כרטיס זה (לרוב אמריקן אקספרס, דיינרס או כרטיסים זרים).' },
    action: { en: 'Ask Tranzila to enable this card brand. Meanwhile the customer can use another card or Bit.', he: 'יש לבקש מטרנזילה להפעיל את מותג הכרטיס. בינתיים הלקוח יכול להשתמש בכרטיס אחר או ב-Bit.' } }],
  '015': ['card_details', { en: 'Card expired', he: 'פג תוקף הכרטיס' }],
  '016': ['configuration', { en: 'Currency not enabled on our terminal', he: 'המטבע אינו מורשה במסוף שלנו' }],
  '017': ['configuration', { en: 'Credit type not allowed (installments?)', he: 'סוג אשראי לא מורשה (תשלומים?)' }, {
    explanation: { en: 'The terminal or the card does not allow this credit type — usually installments.', he: 'המסוף או הכרטיס אינם מאפשרים סוג אשראי זה — לרוב תשלומים.' },
    action: { en: 'The customer can retry with a single payment. If it happens often, ask Tranzila to enable installments.', he: 'הלקוח יכול לנסות שוב בתשלום אחד. אם זה חוזר, יש לבקש מטרנזילה להפעיל תשלומים.' } }],
  '026': ['card_details', { en: 'Wrong ID number', he: 'מספר תעודת זהות שגוי' }],
  '301': ['configuration', { en: 'Foreign currency not enabled on our terminal', he: 'מט"ח אינו מורשה במסוף שלנו' }],
  '318': ['configuration', { en: 'Currency not enabled for this credit type', he: 'המטבע אינו מורשה לסוג אשראי זה' }],
  '341': ['bank_decline', { en: 'Card issuer does not allow this transaction', he: 'המנפיק אינו מתיר עסקה זו' }],
  '342': ['bank_decline', { en: 'Card issuer does not allow this currency', he: 'המנפיק אינו מתיר מטבע זה' }],
  '343': ['bank_decline', { en: 'Card not allowed for online purchases', he: 'הכרטיס אינו מורשה לרכישה אונליין' }],
  '344': ['bank_decline', { en: 'Card not allowed for this credit type (installments?)', he: 'הכרטיס אינו מורשה לסוג אשראי זה (תשלומים?)' }],
  '401': ['configuration', { en: 'Too many installments', he: 'מספר תשלומים גדול מהמותר' }],
  '402': ['configuration', { en: 'Too few installments', he: 'מספר תשלומים קטן מהמותר' }],
  '403': ['configuration', { en: 'Amount too small for installments', he: 'הסכום קטן מדי לתשלומים' }],
  '406': ['configuration', { en: 'Installment amounts do not add up', he: 'סכומי התשלומים אינם מסתכמים' }],
  '416': ['card_details', { en: 'Invalid expiry date', he: 'תאריך תוקף לא תקין' }],
  '417': ['configuration', { en: 'Invalid terminal number', he: 'מספר מסוף לא תקין' }],
  '418': ['configuration', { en: 'Required parameters missing', he: 'חסרים פרמטרים חיוניים' }],
  '429': ['card_details', { en: 'Card is not valid', he: 'הכרטיס אינו תקף' }],
  '431': ['technical', { en: 'General failure', he: 'כשל כללי' }],
  '447': ['card_details', { en: 'Wrong card number', he: 'מספר כרטיס שגוי' }],
  '448': ['configuration', { en: 'Billing address required by the terminal', he: 'המסוף דורש כתובת לחיוב' }],
  '449': ['configuration', { en: 'Zip code required by the terminal', he: 'המסוף דורש מיקוד' }],
  '500': ['cancelled', { en: 'Stopped by the user', he: 'העסקה הופסקה על ידי המשתמש' }],
  '731': ['card_details', { en: 'Card number not found', he: 'מספר הכרטיס לא נמצא' }],
  '800': ['cancelled', { en: 'Transaction cancelled', he: 'העסקה בוטלה' }],
  '900': ['authentication', { en: '3D Secure verification failed', he: 'אימות 3D Secure נכשל' }],
  '901': ['authentication', { en: 'Card authentication failed', he: 'אימות הכרטיס נכשל' }],
  '904': ['authentication', { en: 'Too many verification attempts', he: 'יותר מדי ניסיונות אימות' }],
  '905': ['card_details', { en: 'Card expired', he: 'פג תוקף הכרטיס' }],
  '906': ['card_details', { en: 'Invalid card number', he: 'מספר כרטיס לא תקין' }],
  '910': ['bank_decline', { en: 'Card reported stolen', he: 'כרטיס מדווח כגנוב' }],
  '911': ['bank_decline', { en: 'Suspected fraud', he: 'חשד להונאה' }, {
    action: { en: 'Do not push the customer to retry; if it is a genuine customer, they must call their bank.', he: 'אין לעודד ניסיון נוסף; אם זה לקוח אמיתי, עליו להתקשר לבנק.' } }],
  '912': ['bank_decline', { en: 'Not allowed for this cardholder', he: 'לא מורשה לבעל הכרטיס' }],
  '913': ['authentication', { en: 'Card not enrolled in 3D Secure', he: 'הכרטיס אינו רשום ל-3D Secure' }],
  '914': ['authentication', { en: 'Bank verification timed out', he: 'פג הזמן לאימות הבנק' }],
  '919': ['authentication', { en: 'Too many verification challenges', he: 'יותר מדי ניסיונות אימות' }],
  '922': ['technical', { en: 'Technical issue at the bank\'s verification server', he: 'תקלה טכנית בשרת האימות של הבנק' }],
  '926': ['authentication', { en: '3D Secure not completed by the customer', he: 'הלקוח לא השלים את אימות 3D Secure' }],
  '927': ['cancelled', { en: 'Customer cancelled the bank verification', he: 'הלקוח ביטל את אימות הבנק' }],
  '928': ['cancelled', { en: 'Customer cancelled the bank verification', he: 'הלקוח ביטל את אימות הבנק' }],
  '930': ['authentication', { en: '3D Secure not completed by the customer', he: 'הלקוח לא השלים את אימות 3D Secure' }],
  '997': ['technical', { en: 'General failure at Tranzila', he: 'כשל כללי בטרנזילה' }],
  '998': ['technical', { en: 'Tranzila transactions file failure', he: 'תקלה בקובץ העסקאות של טרנזילה' }, {
    action: { en: 'Contact Tranzila support.', he: 'יש לפנות לתמיכת טרנזילה.' } }],
  '20000': ['configuration', { en: 'Tranzila login failed (terminal credentials)', he: 'ההתחברות לטרנזילה נכשלה (פרטי מסוף)' }, {
    action: { en: 'Check TRANZILA_TERMINAL / TRANZILA_TERMINAL_PASSWORD and the API keys in the server settings.', he: 'יש לבדוק את TRANZILA_TERMINAL / TRANZILA_TERMINAL_PASSWORD ואת מפתחות ה-API בהגדרות השרת.' } }],
  '20002': ['configuration', { en: 'Tranzila authorisation failed (terminal credentials)', he: 'ההרשאה בטרנזילה נכשלה (פרטי מסוף)' }, {
    action: { en: 'Check the terminal name and API keys in the server settings.', he: 'יש לבדוק את שם המסוף ומפתחות ה-API בהגדרות השרת.' } }],
  '20001': ['configuration', { en: 'Request rejected: invalid JSON', he: 'הבקשה נדחתה: JSON לא תקין' }],
  '20003': ['configuration', { en: 'Request rejected: a field has an invalid format', he: 'הבקשה נדחתה: שדה בפורמט לא תקין' }, {
    explanation: {
      en: 'Tranzila refused the request before contacting the bank: one of the fields sent by our checkout (amount, currency, installments, card fields…) does not match their format. The bank never saw this payment.',
      he: 'טרנזילה דחתה את הבקשה לפני הפנייה לבנק: אחד השדות שנשלחו מהצ\'קאאוט (סכום, מטבע, תשלומים, שדות כרטיס...) אינו תואם לפורמט שלהם. הבנק לא ראה את התשלום.',
    },
    action: {
      en: 'Developer issue. The rejected field is listed under "mismatch_info" in the Tranzila response below.',
      he: 'בעיה לטיפול המפתח. השדה שנדחה מופיע תחת "mismatch_info" בתגובת טרנזילה למטה.',
    } }],
  '20111': ['technical', { en: 'Payment token expired or invalid', he: 'אסימון התשלום פג או אינו תקף' }, {
    action: { en: 'The customer should reload the checkout page and pay again.', he: 'על הלקוח לרענן את עמוד התשלום ולשלם שוב.' } }],
  '20112': ['technical', { en: 'Original transaction not found', he: 'העסקה המקורית לא נמצאה' }],
}
KNOWN['20004'] = KNOWN['20003']

function categoryForRange(n: number): TranzilaCodeCategory {
  if (n >= 20000) return 'configuration'
  if (n >= 900 && n < 950) return 'authentication'
  if (n >= 950) return 'technical'
  if (n >= 700) return 'technical'
  if (n >= 500) return 'technical'
  if (n >= 341 && n < 400) return 'bank_decline'
  if (n >= 41) return 'configuration'   // SHVA files / vectors / acquirer permissions / request data
  return 'bank_decline'
}

/** Normalises '51', 51, '051' → '051'; 5-digit API codes are kept as is. */
export function normalizeTranzilaCode(code: unknown): string | undefined {
  if (code == null || code === '') return undefined
  const s = String(code).trim()
  if (!/^\d+$/.test(s)) return undefined
  return s.length < 3 ? s.padStart(3, '0') : s
}

export function describeTranzilaCode(raw: unknown): TranzilaCodeInfo | undefined {
  const code = normalizeTranzilaCode(raw)
  if (!code || code === '000') return undefined
  const official = TRANZILA_OFFICIAL_CODES[code]
  const known = KNOWN[code]
  if (!official && !known) return undefined

  const category = known?.[0] ?? categoryForRange(Number(code))
  const base = CATEGORY_TEXT[category]
  return {
    code,
    official,
    category,
    headline: known?.[1] ?? { en: official!, he: official! },
    explanation: known?.[2]?.explanation ?? base.explanation,
    action: known?.[2]?.action ?? base.action,
  }
}

/** One-line message for logs / error_message / the customer-facing error. */
export function tranzilaCodeMessage(raw: unknown): string | undefined {
  const info = describeTranzilaCode(raw)
  if (!info) return undefined
  return info.official ?? info.headline.en
}
