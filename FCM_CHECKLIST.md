# Firebase Cloud Messaging - Quick Setup Checklist

## ✅ Completed (Automatic)
- [x] Firebase SDK integrated in frontend
- [x] Service worker created (`firebase-messaging-sw.js`)
- [x] FCM routes added to backend (`routes/fcm.js`)
- [x] Database migration SQL created
- [x] Frontend notification handlers updated
- [x] Server integration completed
- [x] Notification sounds integrated with FCM

## 🔧 Manual Steps Required

### 1. Install Firebase Admin SDK
```bash
cd "e:\Coding Files\VB Repo\roomaid"
npm install firebase-admin --save
```

### 2. Run Database Migration
Execute the SQL script to create the FCM tokens table:
```bash
mysql -u root -p roomaid < fcm_migration.sql
```

### 3. Get Firebase Web Push Certificate (VAPID Key)
1. Go to: https://console.firebase.google.com/project/roomaidnotf/settings/cloudmessaging
2. Scroll to "Web Push certificates"
3. Click "Generate key pair" if needed
4. Copy the key

### 4. Update app.js with VAPID Key
Open: `public/app.js`  
Find line ~1000 in `subscribeToFCM()` function  
Replace: `vapidKey: 'BDp0XQN8jKcC5DlZQQ_YKZ3xJ1p6bP7jvR8TGZqMQxF4gRSy5qHOjEKC7Zw8tBvX6mYqJpKnL2fE3oR1cUhV5sM'`  
With your actual Firebase Web Push certificate

### 5. Set Up Firebase Admin SDK (Choose ONE option)

#### Option A: Service Account (Recommended)
1. Go to: https://console.firebase.google.com/project/roomaidnotf/settings/serviceaccounts
2. Click "Generate new private key"
3. Download the JSON file
4. Add to `.env`:
   ```env
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"roomaidnotf",...}
   ```

#### Option B: Server Key (Legacy)
1. Go to: https://console.firebase.google.com/project/roomaidnotf/settings/cloudmessaging
2. Find "Cloud Messaging API (Legacy)"
3. Enable if needed and copy "Server key"
4. Add to `.env`:
   ```env
   FCM_SERVER_KEY=AAAA...your_key_here
   ```

### 6. Restart Server
```bash
npm start
```

### 7. Test Notifications
1. Open the app in browser
2. Allow notification permissions
3. Check console for: "✅ FCM Token obtained"
4. Create a test order
5. Verify notifications are received with sound

## 📝 Files Created/Modified

### New Files:
- `public/firebase-messaging-sw.js` - Service worker for background notifications
- `public/notification-sounds.js` - Sound manager (already existed)
- `routes/fcm.js` - FCM backend routes
- `fcm_migration.sql` - Database schema
- `FCM_SETUP_GUIDE.md` - Complete documentation

### Modified Files:
- `public/index.html` - Added Firebase SDK scripts
- `public/app.js` - Updated notification system to use FCM
- `server.js` - Integrated FCM routes and notification sending

## 🎯 Expected Behavior

### When Order is Created:
1. New order notification appears (green) with ping sound
2. All users in same hotel receive notification
3. Notification shows: "🆕 New Order Received!"
4. Body shows: "Engineering: Room 123"

### For Unclaimed Orders:
1. 3 min: Yellow warning with warning sound
2. 5 min: Orange warning with warning sound
3. 8 min: Red urgent with urgent sound
4. 10+ min: Dark red critical with urgent sound

## ⚠️ Important Notes

- Don't commit `.env` file or service account JSON to git
- Test notifications in different browsers
- Verify sounds play correctly
- Check browser DevTools for errors
- Monitor server logs for FCM sending status

## 🐛 Common Issues

**"FCM not initialized"**
→ Check that `FIREBASE_SERVICE_ACCOUNT` or `FCM_SERVER_KEY` is set

**"No FCM token"**
→ Update VAPID key in `app.js` with your Firebase Web Push certificate

**"Notifications not received"**
→ Check notification permissions in browser settings

**"Database error"**
→ Run the `fcm_migration.sql` script

## 📚 Documentation

For detailed information, see: `FCM_SETUP_GUIDE.md`

---

**Status:** Ready for testing after completing manual steps  
**Estimated Setup Time:** 10-15 minutes
