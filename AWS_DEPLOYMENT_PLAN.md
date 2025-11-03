# AWS Deployment Plan for Internal Knowledge System

## Overview
This document outlines the complete plan to deploy the Internal Knowledge System (RAG Chatbot) to AWS using EC2, with optional integration of AWS managed services for enhanced scalability and reliability.

---

## 🎓 Quick Start for Demo/Thesis

**For students presenting thesis/capstone projects with basic requirements:**
- ✅ Single concurrent user
- ✅ Response time < 10 seconds
- ✅ Cost-effective (~$99/month)
- ✅ Easy setup

### Optimized Configuration:
- **Instance**: `m7i-flex.large` (2 vCPU, 8 GB RAM)
- **Model**: LLaMA 3.2 3B (already configured in `setting.py`)
- **Storage**: 50 GB EBS
- **Total Cost**: ~$99/month

**Jump to**: [Demo Quick Deployment](#demo-quick-deployment)

---

## Architecture Options

### Option 1: Simple EC2 Deployment (Recommended for Start)
**Best for**: Small to medium teams, cost-effective, easiest to deploy

```
┌─────────────────────────────────────────────┐
│          Application Load Balancer          │
│         (ALB with SSL Certificate)          │
└────────────┬───────────────────────┬────────┘
             │                       │
   ┌─────────▼────────┐    ┌────────▼─────────┐
   │  EC2 Instance    │    │  EC2 Instance    │
   │  (Admin Web)     │    │  (User Web)      │
   │  Port 7860       │    │  Port 7861       │
   │                  │    │                  │
   │  + Ollama        │    │  (Shares Ollama) │
   │  + ChromaDB      │    │                  │
   │  + SQLite        │    │                  │
   └──────────────────┘    └──────────────────┘
             │                       │
             └───────────┬───────────┘
                         │
                    ┌────▼─────┐
                    │   EFS    │
                    │ (Shared) │
                    └──────────┘
```

### Option 2: Fully Managed AWS Services (Scalable)
**Best for**: Large teams, high availability requirements

```
┌──────────────────────────────────────────────┐
│         Application Load Balancer            │
│        (Multi-AZ, Auto Scaling)              │
└────────────┬─────────────────────────────────┘
             │
   ┌─────────▼────────────────────────┐
   │      ECS Fargate / EKS           │
   │   (Container Orchestration)      │
   │                                  │
   │  ┌──────────┐    ┌──────────┐   │
   │  │ Admin    │    │  User    │   │
   │  │ Service  │    │ Service  │   │
   │  └──────────┘    └──────────┘   │
   └──────────┬───────────────────────┘
              │
     ┌────────┴─────────┬──────────────┐
     │                  │              │
┌────▼─────┐    ┌──────▼─────┐  ┌────▼─────┐
│   RDS    │    │ SageMaker  │  │  OpenSearch│
│ (SQLite→ │    │  Endpoint  │  │  Service   │
│ PostgreSQL│    │  (Ollama→) │  │ (ChromaDB→)│
└──────────┘    └────────────┘  └────────────┘
```

---

## Deployment Steps: Option 1 (EC2 Single Server)

### Prerequisites
- AWS Account with billing enabled
- Domain name (optional but recommended)
- AWS CLI installed locally
- SSH key pair for EC2 access

---

## Step 1: Launch EC2 Instance

### 1.1 Choose Instance Type

**For Demo/Thesis (Single user, <10s response)**: ✅ **`m7i-flex.large`** (RECOMMENDED)
- **CPU**: 2 vCPUs
- **RAM**: 8 GB (sufficient with LLaMA 3.2 3B model)
- **Storage**: 20 GB EBS gp3 volume (30-50 GB for production)
- **Cost**: ~$86/month (0.1197 USD/hour for Linux)
- **Performance**: <10 seconds response time for single concurrent request
- **Note**: Uses smaller LLM model (`llama3.2:3b`) optimized for 8GB RAM

**For Production (Multiple users, better performance)**: `m7i-flex.xlarge`
- **CPU**: 4 vCPUs
- **RAM**: 16 GB minimum
- **Storage**: 100 GB EBS gp3 volume
- **Cost**: ~$172/month

**GPU Option (Fastest inference)**: `g4dn.xlarge` or `g5.xlarge`
- **CPU**: 4 vCPUs
- **RAM**: 16 GB+
- **GPU**: NVIDIA T4 or A10G (for faster inference)
- **Storage**: 100 GB EBS gp3 volume

### 1.2 Configure Instance
```bash
# AMI: Ubuntu 22.04 LTS (ami-0c7217cdde317cfec or latest)
# Region: Choose closest to your users (e.g., us-east-1, ap-southeast-1)
```

### 1.3 Security Group Rules
Create security group `knowledge-system-sg`:

| Type        | Protocol | Port Range | Source          | Description           |
|-------------|----------|------------|-----------------|-----------------------|
| SSH         | TCP      | 22         | Your IP         | Admin access          |
| HTTP        | TCP      | 80         | 0.0.0.0/0       | HTTP redirect         |
| HTTPS       | TCP      | 443        | 0.0.0.0/0       | HTTPS access          |
| Custom TCP  | TCP      | 7860       | 0.0.0.0/0       | Admin web (temp)      |
| Custom TCP  | TCP      | 7861       | 0.0.0.0/0       | User web (temp)       |
| Custom TCP  | TCP      | 11434      | Security Group  | Ollama (internal)     |

---

## Step 2: Initial Server Setup

### 2.1 Connect to Instance
```bash
# Download your key pair (e.g., knowledge-system-key.pem)
chmod 400 knowledge-system-key.pem
ssh -i knowledge-system-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### 2.2 Install Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install NVIDIA Docker (if using GPU instance)
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Install Python and Git
sudo apt install -y python3-pip python3-venv git

# Install Nginx (reverse proxy)
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## Step 3: Deploy Application

### 3.1 Clone Repository
```bash
cd /opt
sudo git clone <YOUR_REPO_URL> knowledge-system
sudo chown -R ubuntu:ubuntu knowledge-system
cd knowledge-system
```

### 3.2 Configure Environment
```bash
# Create .env file
cat > .env << EOF
# Flask Configuration
FLASK_ENV=production
SECRET_KEY=$(openssl rand -hex 32)

# Ollama Configuration
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2:latest

# ChromaDB Configuration
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Database Configuration
DATABASE_PATH=./data/knowledge_base.db

# Security
SESSION_TIMEOUT=86400
MAX_UPLOAD_SIZE=50MB
EOF
```

### 3.3 Create Production Docker Compose
```bash
cat > docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  chromadb:
    image: chromadb/chroma:latest
    container_name: chromadb
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
    restart: unless-stopped

  admin_web:
    build: .
    container_name: admin_web
    command: python run_admin_web.py
    ports:
      - "7860:7860"
    volumes:
      - ./data:/code/data
      - ./UI:/code/UI
    environment:
      - OLLAMA_HOST=http://ollama:11434
      - CHROMA_HOST=chromadb
      - CHROMA_PORT=8000
    depends_on:
      - ollama
      - chromadb
    restart: unless-stopped

  user_web:
    build: .
    container_name: user_web
    command: python run_user_web.py
    ports:
      - "7861:7861"
    volumes:
      - ./data:/code/data
      - ./UI:/code/UI
    environment:
      - OLLAMA_HOST=http://ollama:11434
      - CHROMA_HOST=chromadb
      - CHROMA_PORT=8000
    depends_on:
      - ollama
      - chromadb
    restart: unless-stopped

volumes:
  ollama_data:
  chroma_data:
EOF
```

### 3.4 Start Services
```bash
# Pull and start Ollama model
docker-compose -f docker-compose.prod.yml up -d ollama
sleep 10
docker exec ollama ollama pull qwen2:latest

# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
```

---

## Step 4: Configure Nginx Reverse Proxy

### 4.1 Create Nginx Configuration
```bash
sudo nano /etc/nginx/sites-available/knowledge-system
```

**Add this configuration:**
```nginx
# Admin Web - admin.yourdomain.com
server {
    listen 80;
    server_name admin.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:7860;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeouts for long-running requests
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
    
    client_max_body_size 50M;
}

# User Web - knowledge.yourdomain.com
server {
    listen 80;
    server_name knowledge.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:7861;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
    
    client_max_body_size 50M;
}
```

### 4.2 Enable Configuration
```bash
sudo ln -s /etc/nginx/sites-available/knowledge-system /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Step 5: Configure SSL with Let's Encrypt

### 5.1 Point DNS to EC2
```
# In your domain provider (GoDaddy, Cloudflare, Route53):
admin.yourdomain.com    ->  A Record  ->  <EC2_PUBLIC_IP>
knowledge.yourdomain.com ->  A Record  ->  <EC2_PUBLIC_IP>
```

### 5.2 Obtain SSL Certificates
```bash
sudo certbot --nginx -d admin.yourdomain.com -d knowledge.yourdomain.com
```

Follow prompts:
- Enter email for renewal notifications
- Agree to terms
- Choose option 2: Redirect HTTP to HTTPS

### 5.3 Test Auto-Renewal
```bash
sudo certbot renew --dry-run
```

---

## Step 6: Setup Monitoring and Logs

### 6.1 CloudWatch Agent (Optional)
```bash
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i -E ./amazon-cloudwatch-agent.deb

# Configure CloudWatch
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard
```

### 6.2 Setup Log Rotation
```bash
sudo nano /etc/logrotate.d/knowledge-system
```

Add:
```
/opt/knowledge-system/data/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
}
```

### 6.3 View Logs
```bash
# Application logs
docker-compose -f docker-compose.prod.yml logs -f admin_web
docker-compose -f docker-compose.prod.yml logs -f user_web

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## Step 7: Backup Strategy

### 7.1 Automated Backups
```bash
# Create backup script
cat > /opt/knowledge-system/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
cp /opt/knowledge-system/data/knowledge_base.db $BACKUP_DIR/db_$DATE.db

# Backup chat history
tar -czf $BACKUP_DIR/chat_history_$DATE.tar.gz /opt/knowledge-system/data/chat_history/

# Backup documents
tar -czf $BACKUP_DIR/documents_$DATE.tar.gz /opt/knowledge-system/data/documents/

# Upload to S3 (optional)
# aws s3 sync $BACKUP_DIR s3://your-backup-bucket/knowledge-system/

# Keep only last 30 days
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /opt/knowledge-system/backup.sh
```

### 7.2 Schedule Backups
```bash
# Add to crontab
crontab -e

# Add this line (daily at 2 AM):
0 2 * * * /opt/knowledge-system/backup.sh >> /var/log/backup.log 2>&1
```

### 7.3 S3 Backup (Recommended)
```bash
# Install AWS CLI
sudo apt install -y awscli

# Configure AWS credentials
aws configure

# Create S3 bucket
aws s3 mb s3://knowledge-system-backups-$(date +%s)

# Test upload
aws s3 cp /opt/knowledge-system/data/knowledge_base.db s3://your-bucket/test.db
```

---

## Step 8: Security Hardening

### 8.1 Configure Firewall
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 8.2 Disable Password Authentication
```bash
sudo nano /etc/ssh/sshd_config

# Set:
PasswordAuthentication no
PermitRootLogin no

sudo systemctl restart sshd
```

### 8.3 Setup Fail2Ban
```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 8.4 Regular Updates
```bash
# Create update script
cat > /opt/update-system.sh << 'EOF'
#!/bin/bash
apt update
apt upgrade -y
apt autoremove -y
docker system prune -af
EOF

chmod +x /opt/update-system.sh

# Schedule weekly updates (Sunday 3 AM)
crontab -e
# Add: 0 3 * * 0 /opt/update-system.sh >> /var/log/system-update.log 2>&1
```

---

## Cost Estimation

### Demo/Thesis Option (Monthly) ⭐ RECOMMENDED FOR YOUR USE CASE
| Service          | Type               | Cost (USD) |
|------------------|--------------------|------------|
| EC2 Instance     | m7i-flex.large     | ~$86/mo    |
| EBS Storage      | 20GB gp3           | ~$1.60/mo  |
| Data Transfer    | 100GB out          | ~$9/mo     |
| Elastic IP       | 1 static IP        | Free       |
| **Total**        |                    | **~$96.60/mo** |

**Suitable for:**
- Single user demos (thesis presentation)
- Response time < 10 seconds
- 1 concurrent request at a time
- Uses LLaMA 3.2 3B model (optimized for 8GB RAM)
- 5-10 documents uploaded

**Note**: Use 30-50 GB storage if you need more documents or longer retention.

### Production Option (Monthly)
| Service          | Type               | Cost (USD) |
|------------------|--------------------|------------|
| EC2 Instance     | m7i-flex.xlarge    | ~$172/mo   |
| EBS Storage      | 100GB gp3          | ~$8/mo     |
| Data Transfer    | 500GB out          | ~$45/mo    |
| Elastic IP       | 1 static IP        | Free       |
| **Total**        |                    | **~$225/mo** |

### GPU Option (Fastest, Multiple Users)
| Service          | Type               | Cost (USD) |
|------------------|--------------------|------------|
| EC2 Instance     | g4dn.xlarge        | ~$390/mo   |
| EBS Storage      | 100GB gp3          | ~$8/mo     |
| Data Transfer    | 500GB out          | ~$45/mo    |
| Elastic IP       | 1 static IP        | Free       |
| **Total**        |                    | **~$443/mo** |
| Data Transfer    | 100GB out          | ~$9/mo     |
| **Total**        |                    | **~$167/mo** |

---

## Scaling Options

### Horizontal Scaling (Multiple Servers)
```bash
# Use Application Load Balancer
# Deploy multiple EC2 instances
# Use RDS for shared database
# Use EFS for shared file storage
```

### Vertical Scaling
```bash
# Increase instance size:
# g4dn.xlarge → g4dn.2xlarge (more GPU memory)
# t3.xlarge → t3.2xlarge (more CPU/RAM)
```

---

## Maintenance Checklist

### Daily
- [ ] Check application logs for errors
- [ ] Monitor disk usage: `df -h`
- [ ] Check Docker container status

### Weekly
- [ ] Review CloudWatch metrics
- [ ] Check backup completion
- [ ] Review security logs

### Monthly
- [ ] Update system packages
- [ ] Review and optimize costs
- [ ] Test disaster recovery
- [ ] Update SSL certificates (auto-renewal should handle)

---

## Troubleshooting

### Service won't start
```bash
docker-compose -f docker-compose.prod.yml logs <service_name>
docker-compose -f docker-compose.prod.yml restart <service_name>
```

### Out of disk space
```bash
# Clean Docker
docker system prune -af --volumes

# Check large files
du -sh /opt/knowledge-system/data/*
```

### High memory usage
```bash
# Check container stats
docker stats

# Restart services
docker-compose -f docker-compose.prod.yml restart
```

### Can't access via domain
```bash
# Check DNS
nslookup admin.yourdomain.com

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Check firewall
sudo ufw status
```

---

## Alternative: AWS Managed Services

If you need higher availability and scalability, consider:

1. **Amazon ECS Fargate**: Serverless containers
2. **Amazon RDS**: PostgreSQL instead of SQLite
3. **Amazon OpenSearch**: Vector search instead of ChromaDB
4. **Amazon SageMaker**: Host Ollama model as endpoint
5. **Amazon S3**: Document storage
6. **Amazon EFS**: Shared file system
7. **AWS Application Load Balancer**: Auto-scaling
8. **Amazon CloudFront**: CDN for static assets

Cost: ~$800-1500/month depending on usage

---

## Support & Updates

### Update Application
```bash
cd /opt/knowledge-system
git pull origin main
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

### Rollback
```bash
git checkout <previous_commit>
docker-compose -f docker-compose.prod.yml up -d --build
```

---

## Demo Quick Deployment

### 🎓 Fast Setup for Thesis/Demo Presentation (30 minutes)

This guide is optimized for students who need a working demo ASAP with minimal cost.

#### Requirements:
- ✅ AWS Account
- ✅ Credit card for AWS (will cost ~$3-5 for a few days of demo)
- ✅ Basic terminal knowledge

#### Step-by-Step:

### 1. Launch EC2 Instance (5 minutes)

```bash
# 1.1 Go to EC2 Console: https://console.aws.amazon.com/ec2

# 1.2 Click "Launch Instance"

# 1.3 Configure:
Name: knowledge-system-demo
AMI: Ubuntu Server 22.04 LTS (Free tier eligible)
Instance type: m7i-flex.large
Key pair: Create new (download .pem file, keep it safe!)

# 1.4 Network Settings:
Security group: Create new
  - SSH (port 22): My IP
  - HTTP (port 80): Anywhere (0.0.0.0/0)
  - Custom TCP (7860): Anywhere (for admin web)
  - Custom TCP (7861): Anywhere (for user web)

# 1.5 Storage:
50 GB gp3

# 1.6 Click "Launch Instance"
```

### 2. Connect to Instance (2 minutes)

```bash
# Download your key pair (e.g., knowledge-demo.pem)
# On your computer:

# Windows (use PowerShell or WSL):
chmod 400 knowledge-demo.pem
ssh -i knowledge-demo.pem ubuntu@<YOUR_EC2_PUBLIC_IP>

# Find Public IP in EC2 Console → Instances → Select your instance
```

### 3. Install Dependencies (5 minutes)

```bash
# Once connected to EC2:

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Log out and log back in for docker group to take effect
exit

# SSH back in
ssh -i knowledge-demo.pem ubuntu@<YOUR_EC2_PUBLIC_IP>

# Install Docker Compose
sudo apt install -y docker-compose

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh
```

### 4. Setup Application (10 minutes)

```bash
# Clone repository
cd /home/ubuntu
git clone <YOUR_REPO_URL> knowledge-system
cd knowledge-system

# Pull LLaMA model (this takes ~5 minutes, 2GB download)
ollama pull llama3.2:3b

# Start Ollama server in background
ollama serve &

# Install Python dependencies
sudo apt install -y python3-pip
pip3 install -r requirements.txt

# Create data directory
mkdir -p data/documents data/chat_history
```

### 5. Start Services (3 minutes)

```bash
# Start admin web (terminal 1)
python3 run_admin_web.py &

# Start user web (terminal 2)
python3 run_user_web.py &

# Check if running
ps aux | grep python
```

### 6. Access Your Demo (2 minutes)

```bash
# Get your EC2 Public IP
curl http://checkip.amazonaws.com

# Open in browser:
# Admin Web: http://<YOUR_EC2_IP>:7860
# User Web:  http://<YOUR_EC2_IP>:7861

# Default credentials:
# Admin: admin / admin123
# User: user1 / user123
```

### 7. Test Your System (3 minutes)

**Admin Web:**
1. Login as admin
2. Upload a sample PDF document
3. Wait for processing (check console logs)

**User Web:**
1. Login as user
2. Ask a question about your document
3. Should get response in < 10 seconds ✅

---

### 💰 Cost Breakdown for Demo:

**If you only need it for 1 week (thesis presentation):**
- m7i-flex.large: 168 hours × $0.1197 = ~$20
- 50GB storage: ~$0.92
- Data transfer: ~$2
- **Total: ~$23 for 1 week**

**Stop instance when not presenting to save money:**
```bash
# On EC2 Console: Actions → Instance State → Stop
# Start again before presentation
```

---

### 🔧 Quick Troubleshooting:

**Service not starting:**
```bash
# Check logs
tail -f /var/log/syslog

# Restart services
pkill -f run_admin_web
pkill -f run_user_web
python3 run_admin_web.py &
python3 run_user_web.py &
```

**Slow response (> 10 seconds):**
```bash
# Check Ollama
ollama list

# Check RAM usage
free -h

# If RAM is full, restart Ollama
pkill ollama
ollama serve &
```

**Can't connect:**
```bash
# Check security group rules in EC2 Console
# Make sure ports 7860, 7861 are open to 0.0.0.0/0
```

---

### 📝 For Your Thesis Documentation:

**System Architecture Diagram:**
```
User Browser → EC2 Instance (m7i-flex.large)
                ├── Admin Web (Flask, port 7860)
                ├── User Web (Flask, port 7861)
                ├── Ollama LLM (LLaMA 3.2 3B)
                ├── ChromaDB (Vector Store)
                └── SQLite (Metadata)
```

**Technical Specifications:**
- Cloud Platform: AWS EC2
- Instance Type: m7i-flex.large (2 vCPU, 8GB RAM)
- LLM Model: LLaMA 3.2 3B (3 billion parameters)
- Embedding Model: BAAI/bge-small-en-v1.5
- Vector Database: ChromaDB
- Backend Framework: Flask (Python)
- Frontend: HTML/CSS/JavaScript
- Response Time: < 10 seconds (single user)
- Monthly Cost: ~$99 (or ~$23/week for demo)

---

## Contacts & Resources

- **AWS Documentation**: https://docs.aws.amazon.com/
- **Docker Documentation**: https://docs.docker.com/
- **Nginx Documentation**: https://nginx.org/en/docs/
- **Let's Encrypt**: https://letsencrypt.org/docs/

---

**Deployment Date**: [To be filled]  
**Deployed By**: [To be filled]  
**Version**: 1.0
