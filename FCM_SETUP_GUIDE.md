# Firebase Cloud Messaging (FCM) Integration Guide for RoomAid

## Overview
RoomAid now uses Firebase Cloud Messaging for reliable, cross-platform push notifications. This replaces the previous web-push implementation with Google's robust FCM service.

## What Changed

### Frontend Changes:
- **Firebase SDK** integrated in `index.html` 
- **Service Worker** updated to `firebase-messaging-sw.js` for background notifications
- **Token Management** replaces VAPID subscriptions with FCM tokens
- **Notification Handling** improved with FCM's message handling

### Backend Changes:
- **New Route** `/routes/fcm.js` for FCM token management
- **Database Table** `fcm_tokens` stores device tokens
- **Notification Sending** uses Firebase Admin SDK or HTTP API

## Setup Instructions

### Step 1: Install Dependencies

```bash
npm install firebase-admin --save
```

### Step 2: Create Database Table

Run the SQL migration script:

```bash
mysql -u your_username -p your_database < fcm_migration.sql
```

Or execute the SQL directly in your database management tool.

### Step 3: Get Firebase Web Push Certificate

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `roomaidnotf`
3. Go to **Project Settings** → **Cloud Messaging** tab
4. Scroll to **Web configuration** → **Web Push certificates**
5. Click **Generate key pair** (if not already generated)
6. Copy the **Key pair** value

### Step 4: Update the VAPID Key in app.js

Open `public/app.js` and find the `subscribeToFCM` function (around line 1000):

```javascript
const token = await getToken(window.firebaseMessaging, {
    vapidKey: 'YOUR_WEB_PUSH_CERTIFICATE_HERE' // Replace this
});
```

Replace `YOUR_WEB_PUSH_CERTIFICATE_HERE` with your Firebase Web Push certificate.

### Step 5: Set Up Firebase Admin SDK (Backend)

#### Option A: Using Service Account JSON (Recommended)

1. In Firebase Console, go to **Project Settings** → **Service Accounts**
2. Click **Generate new private key**
3. Save the JSON file securely (DON'T commit to git!)
4. Add to your `.env` file:

```env
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"roomaidnotf",...}
```

Or set the environment variable to the JSON content.

#### Option B: Using FCM Server Key (Legacy)

1. In Firebase Console, go to **Project Settings** → **Cloud Messaging**
2. Find **Cloud Messaging API (Legacy)** section
3. Copy the **Server key**
4. Add to `.env`:

```env
FCM_SERVER_KEY=your_server_key_here
```

### Step 6: Test the Integration

1. Restart your server:
   ```bash
   npm start
   ```

2. Open the app in a browser
3. Allow notification permissions when prompted
4. Check the browser console for:
   ```
   ✅ FCM Token obtained: ...
   ✅ FCM token saved to server
   ```

5. Create a test order and verify notifications are received

## How It Works

### Notification Flow:

1. **User Opens App** → Requests notification permission
2. **Permission Granted** → Gets FCM token from Firebase
3. **Token Registration** → Sends token to server via `/api/fcm/subscribe`
4. **Server Stores Token** → Saves in `fcm_tokens` table
5. **Order Created** → Server sends notification to all hotel users
6. **FCM Delivers** → Firebase sends to all registered devices
7. **User Receives** → Notification appears with sound

### Notification Types:

- **New Order** (Level 0): Green notification with gentle ping
- **3 min Warning** (Level 1): Yellow notification with warning sound
- **5 min Warning** (Level 2): Orange notification with warning sound
- **8 min Urgent** (Level 3): Red notification with urgent sound
- **10+ min Critical** (Level 4): Dark red notification with urgent sound

## Troubleshooting

### "FCM Token not obtained"
- Check that you've added the correct Web Push certificate in `app.js`
- Verify Firebase project configuration in `index.html`
- Check browser console for errors

### "Notifications not received"
- Ensure notification permissions are granted in browser
- Check that FCM tokens are being saved to database
- Verify Firebase Admin SDK is properly configured
- Check server logs for FCM sending errors

### "Background notifications not working"
- Verify `firebase-messaging-sw.js` is accessible at root
- Check service worker registration in browser DevTools
- Ensure Firebase config in service worker matches your project

### Database Errors
- Make sure `fcm_tokens` table exists
- Check that user has INSERT/UPDATE permissions
- Verify connection to database is working

## Migration from Web Push

The old web-push system is still in the code but will be gradually phased out. To complete migration:

1. ✅ FCM routes added
2. ✅ FCM service worker created
3. ✅ Frontend updated to use FCM
4. 🔄 Optional: Remove old `notf` table after confirming FCM works
5. 🔄 Optional: Remove web-push dependencies

## Security Notes

⚠️ **IMPORTANT:**
- Never commit Firebase service account JSON to version control
- Use environment variables for all sensitive keys
- Restrict Firebase API keys to your domain in Firebase Console
- Regularly rotate service account keys
- Keep Firebase SDK versions updated

## Benefits of FCM

✅ **Reliable Delivery** - Google's infrastructure ensures messages arrive  
✅ **Cross-Platform** - Works on all major browsers and platforms  
✅ **Battery Efficient** - Optimized for mobile devices  
✅ **Rich Notifications** - Support for images, actions, and more  
✅ **Analytics** - Built-in delivery and engagement tracking  
✅ **Scalable** - Handles millions of devices effortlessly

## Support

For issues or questions:
- Check Firebase Console for delivery logs
- Review server logs for FCM errors
- Test with Firebase's Send Test Message feature
- Contact Rubble Tech support

---

**Version:** 2.0.0  
**Last Updated:** January 10, 2026  
**Developed by:** Rubble Tech
