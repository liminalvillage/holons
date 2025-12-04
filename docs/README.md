# Harvest 🌱

Harvest is a dashboard for visualizing and interacting with holonic networks. It provides an intuitive interface for monitoring and managing holonic systems.

## Features

### Holonic Network Visualization 🕸️
- Interactive network graph showing holons and their relationships
- Real-time updates of holon states and connections
- Zoom and pan controls for easy navigation
- Color-coded nodes representing different holon types and states

### Holon Management 🎛️
- View detailed information about individual holons
- Monitor holon health and status
- Inspect holon properties and configurations
- Track holon relationships and dependencies

### Sidebar Controls 📊
- Filter holons by type or status
- Search functionality to quickly find specific holons
- Collapsible sidebar for maximizing view space
- Real-time metrics and statistics

## Getting Started

### Prerequisites
- Node.js (v20 or higher)
- npm or yarn

### Installation

1. Clone the repository:

```bash
git clone https://github.com/liminalvillage/harvest.git
```

2. Install dependencies:

```bash
yarn 
```

3. Run the development server:

```bash
yarn dev
```

## Memory Management

When working with large holonic networks, memory usage can be significant due to the amount of data being processed and visualized. If you encounter "JavaScript heap out of memory" errors, you can use the provided script to start the application with increased memory limits.

### Using the Memory-Optimized Startup Script

We've included a script that increases Node.js memory limits:

```bash
# Make the script executable (only needed once)
chmod +x start-with-memory.sh

# Run the application with increased memory limits
./start-with-memory.sh
```

### Manual Memory Configuration

You can also set the memory limits manually:

```bash
# Set Node.js memory limit to 4GB
export NODE_OPTIONS="--max-old-space-size=4096" 
yarn dev
```

### Additional Memory Optimization Tips

1. If you're not actively using certain visualizations, switch to a different view to reduce memory usage
2. The application implements automatic memory optimization for long-running sessions
3. For production deployments, consider setting appropriate memory limits based on your server specifications