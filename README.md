# RoomAid - Hotel Task Management System

A simple, lightweight hotel task management system built with vanilla HTML/CSS/JavaScript frontend and Node.js backend with SQL Server.

## Features

🔒 **Secure Authentication**
- Login with username, password, and hotel code
- JWT-based session management
- Hotel-specific data isolation

🏨 **Hotel-Specific Dashboards**
- Isolated hotel environments
- Clean, modern UI
- Mobile-responsive design

🧾 **Order Management**
- Two departments: Engineering and Housekeeping
- Real-time order tracking
- Complete order workflow with timestamps
- User attribution for all actions

📝 **Add Orders**
- Simple form for creating new orders
- Department selection
- Room number and notes support
- Automatic user and timestamp tracking

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Backend**: Node.js with Express
- **Database**: SQL Server with mssql package
- **Authentication**: JWT tokens
- **Styling**: Custom CSS with modern design

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Ensure your SQL Server is running and accessible. The system will automatically create the required tables on first run.

### 3. Environment Configuration (Optional)

Create a `.env` file in the root directory to override default database settings:

```env
DB_USER=your_username
DB_PASSWORD=your_password
DB_SERVER=your_server
DB_NAME=your_database
DB_PORT=1434
JWT_SECRET=your-secret-key
```

### 4. Start the Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

### 5. Seed Sample Data (Optional)

Open your browser console and run:

```javascript
seedData()
```

This will create:
- Sample hotel (HOTEL001)
- Test user (admin/password123)
- Sample orders for testing

## Default Login Credentials (after seeding)

- **Username**: admin
- **Password**: password123
- **Hotel Code**: HOTEL001

## Database Schema

```sql
-- Hotels table
hotels (
  id NVARCHAR(50) PRIMARY KEY,
  code NVARCHAR(50) UNIQUE NOT NULL,
  name NVARCHAR(100) NOT NULL,
  createdAt DATETIME DEFAULT GETDATE(),
  updatedAt DATETIME DEFAULT GETDATE()
)

-- Users table
users (
  id NVARCHAR(50) PRIMARY KEY,
  username NVARCHAR(50) UNIQUE NOT NULL,
  passwordHash NVARCHAR(255) NOT NULL,
  hotelCode NVARCHAR(50) NOT NULL,
  role NVARCHAR(20) DEFAULT 'employee',
  createdAt DATETIME DEFAULT GETDATE(),
  updatedAt DATETIME DEFAULT GETDATE(),
  FOREIGN KEY (hotelCode) REFERENCES hotels(code)
)

-- Orders table
orders (
  id NVARCHAR(50) PRIMARY KEY,
  department NVARCHAR(20) NOT NULL,
  roomNumber NVARCHAR(20) NOT NULL,
  notes NVARCHAR(500),
  createdAt DATETIME DEFAULT GETDATE(),
  createdBy NVARCHAR(50) NOT NULL,
  hotelId NVARCHAR(50) NOT NULL,
  completedAt DATETIME NULL,
  completedBy NVARCHAR(50) NULL,
  FOREIGN KEY (createdBy) REFERENCES users(id),
  FOREIGN KEY (completedBy) REFERENCES users(id),
  FOREIGN KEY (hotelId) REFERENCES hotels(id)
)
```

## API Endpoints

- `POST /api/auth/login` - User authentication
- `POST /api/auth/logout` - User logout
- `GET /api/orders?department=<dept>` - Get orders by department
- `POST /api/orders` - Create new order
- `POST /api/orders/:id/complete` - Complete an order
- `POST /api/seed` - Seed sample data (development)

## Usage

### Login
1. Navigate to the application
2. Enter your username, password, and hotel code
3. You'll be redirected to your hotel-specific dashboard

### Dashboard
- **Engineering Tab**: View and manage engineering orders
- **Housekeeping Tab**: View and manage housekeeping orders
- **Add Order**: Create new orders for either department
- **Complete Orders**: Mark orders as completed with timestamps

### Order Management
- Each order shows room number, notes, creation time, and creator
- Click "Complete" to mark an order as finished
- Completed orders show completion time and completer username

## Project Structure

```
├── server.js              # Main Express server
├── config.js              # Configuration settings
├── database.js            # Database connection and queries
├── auth.js                # Authentication utilities
├── package.json           # Dependencies
├── public/                # Frontend files
│   ├── index.html         # Main HTML file
│   ├── styles.css         # CSS styles
│   └── app.js            # Frontend JavaScript
└── README.md             # This file
```

## Development

### Available Scripts

- `npm start` - Start the server
- `npm run dev` - Start with nodemon for development

### Adding New Features

1. **Backend**: Add new routes in `server.js`
2. **Frontend**: Update HTML structure and JavaScript in `public/`
3. **Database**: Modify queries in `database.js`

## Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Hotel-specific data isolation
- Input validation
- SQL injection protection

## Troubleshooting

### Database Connection Issues
1. Verify SQL Server is running
2. Check database credentials in `config.js`
3. Ensure the database exists
4. Verify network connectivity

### Application Issues
1. Check browser console for client-side errors
2. Review server logs for API errors
3. Verify all environment variables are set correctly

## Production Deployment

1. Set up your production environment variables
2. Ensure SQL Server is accessible from your production environment
3. Use a process manager like PM2: `pm2 start server.js`
4. Set up a reverse proxy (nginx) if needed

## License

This project is built for hotel task management and is ready for production use,if you have any questions about pricing or any inquiries about the system please contact rubble-teck@outlook.com

This software is proprietary and may not be copied, modified, or distributed without written permission.
© 2025 Ahmad Alshara. All rights reserved.
