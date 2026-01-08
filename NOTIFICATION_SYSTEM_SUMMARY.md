# RoomAid Notification System Summary

## Overview
The system has been updated to implement a **4-level progressive notification escalation** for unclaimed orders: 3 minutes, 5 minutes, 8 minutes, and 10+ minutes (urgent).

## Notification Flow

### 1. Frontend - Client-Side Polling (`public/app.js`)
**File:** `public/app.js` - Lines 685-725

**Function:** `checkPendingNotifications()`
- Polls the `/api/notifications/pending` endpoint every 30 seconds
- Triggered on page load and continues every 30 seconds
- Tracks seen notifications to avoid duplicates using `seenNotificationIds` Set
- Calls `showPendingOrderNotification()` when new pending orders are found

**Function:** `showPendingOrderNotification()` - Lines 730-815
- Displays toast notifications for pending orders
- **Color scheme by level:**
  - Level 1 (3 mins): Yellow (#f59e0b)
  - Level 2 (5 mins): Orange (#ff8c00)
  - Level 3 (8 mins): Red (#dc2626)
  - Level 4 (10+ mins): Dark Red (#7f1d1d) with stronger shadow
- **Messages:**
  - Level 1: "⏰ Pending Order (3 mins)"
  - Level 2: "⏰ Pending Order (5 mins)"
  - Level 3: "⚠️ Unclaimed Order (8 mins)"
  - Level 4: "🚨 URGENT: Unclaimed Order (10 mins)"
- Auto-dismiss timing: 6s (L1), 7s (L2), 8s (L3), 10s (L4)

**Function:** `sendPushNotificationToDevice()` - Lines 986-1025
- Sends web push notifications via service worker
- Uses the same level-based messaging as toast notifications

### 2. Backend - API Endpoint (`server.js`)
**File:** `server.js` - Lines 1879-2035

**Endpoint:** `GET /api/notifications/pending`
- Queries both `engineering_orders` and `housekeeping_orders` tables
- **For each notification level:**
  - **Level 1 (3 mins)**: All orders older than 3 minutes, not assigned
  - **Level 2 (5 mins)**: All orders older than 5 minutes, not assigned
  - **Level 3 (8 mins)**: All orders older than 8 minutes, not assigned
  - **Level 4 (10 mins)**: All orders older than 10 minutes, not assigned

- **Role-based visibility:**
  - **Employees**: Receive levels 1 & 2 notifications
  - **Supervisors/Managers/Admins**: Receive all 4 levels (1, 2, 3, 4)

- **Database tracking:**
  - Uses `order_notifications` table to track which notifications have been sent
  - Prevents duplicate notifications using `NOT EXISTS` checks
  - Records notification level (1-4) and timestamp

### 3. Order Card UI (`public/app.js`)
**File:** `public/app.js` - Lines 1128-1145 (badge logic)

**Function:** `createOrderCard()`
- Calculates overdue status for pending orders
- **Overdue levels:**
  - Level 1: 3+ minutes old
  - Level 2: 5+ minutes old
  - Level 3: 8+ minutes old
  - Level 4: 10+ minutes old (urgent)
- Displays colored badge on order card with emoji and time
- **CSS Styling:** Lines 890-930 in `public/styles.css`
  - Progressive animation intensity (pulse effect stronger for urgent)
  - Responsive to dark mode

### 4. CSS Styling (`public/styles.css`)
**File:** `public/styles.css` - Lines 890-937

**Badge Styling:**
```css
.overdue-badge.overdue-level-1 → Yellow (#f59e0b)
.overdue-badge.overdue-level-2 → Orange (#ff8c00)
.overdue-badge.overdue-level-3 → Red (#dc2626)
.overdue-badge.overdue-level-4 → Dark Red (#7f1d1d) with glow effect
```

**Animations:**
- `pulse-warning`: 2s cycle for levels 1-3
- `pulse-urgent`: 1s cycle with shadow glow for level 4

### 5. Utility Functions (Optional - Not Currently Used)
**File:** `utils/orderNotifications.js`

Contains server-side reminder scheduling functions:
- `notifyNewOrder()`: Sends initial notification
- `scheduleReminders()`: Sets up 4 level-based reminders (3, 5, 8, 10 mins)
- `clearReminders()`: Cancels reminders when order is accepted

⚠️ **Note:** This file is exported but NOT imported in server.js. The primary notification system uses the polling endpoint instead.

## Data Flow Diagram

```
Order Created
    ↓
Order stored in database (assigned_to = NULL, created_at = now())
    ↓
Client polls /api/notifications/pending every 30 seconds
    ↓
Server checks order age:
  - 3+ mins → Level 1 notification
  - 5+ mins → Level 2 notification
  - 8+ mins → Level 3 notification
  - 10+ mins → Level 4 notification
    ↓
Records sent notification in order_notifications table
    ↓
Client receives notification
    ↓
Displays:
  - Toast notification with color/message based on level
  - Badge on order card with urgency indicator
    ↓
Order card updates every time UI refreshes
```

## Database Tables Involved

### engineering_orders / housekeeping_orders
- `id`: Order ID
- `order_name`: Room number
- `order_notes`: Task details
- `sent_by`: User who created order
- `assigned_to`: User who accepted order (NULL while pending)
- `created_at`: Order creation timestamp
- `completed_at`: Completion timestamp (NULL if incomplete)
- `hotel_code`: Hotel identifier

### order_notifications
- `order_id`: Reference to order
- `order_type`: 'engineering' or 'housekeeping'
- `hotel_code`: Hotel identifier
- `notification_level`: 1, 2, 3, or 4
- `sent_at`: Timestamp of notification

## Key Features

✅ **Progressive Escalation**: Visual and notification intensity increases with age
✅ **Role-based Access**: Managers see urgent alerts before regular employees
✅ **Persistent Tracking**: Database prevents duplicate notifications
✅ **Real-time Updates**: Frontend refreshes every 30 seconds
✅ **Visual Indicators**: Both toast and on-card badges show urgency
✅ **Dark Mode Support**: Full CSS support for theme variations
✅ **Service Worker Integration**: Works even when tab is closed

## Testing Notes

To test the system:
1. Create a new order
2. Wait 3+ minutes - Level 1 notification appears (yellow)
3. Wait 5+ minutes - Level 2 notification appears (orange)
4. Wait 8+ minutes - Level 3 notification appears (red) - Managers/Supervisors see this
5. Wait 10+ minutes - Level 4 notification appears (dark red, urgent) - Managers/Supervisors see this
6. Order card badge color/message changes progressively
7. Each notification is only sent once per level per order
