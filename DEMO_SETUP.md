# 🎓 Quick Demo Setup Guide (30 Minutes)

**Dành cho demo đồ án tốt nghiệp - Đơn giản, nhanh, rẻ**

## ✨ Tóm tắt
- **If you only need it for 1 week (thesis presentation):**
- m7i-flex.large: 168 hours × $0.1197 = ~$20
- 20GB storage: $0.40/week
- Data transfer: ~$2
- **Total: ~$22.50 for 1 week**
- **Thời gian setup**: 30 phút
- **Yêu cầu**: 1 user, trả lời < 10 giây
- **Instance**: AWS EC2 m7i-flex.large (8GB RAM)

---

## 🚀 Các bước thực hiện

### Bước 1: Tạo EC2 Instance (5 phút)

1. Truy cập [AWS EC2 Console](https://console.aws.amazon.com/ec2)
2. Click **"Launch Instance"**
3. Cấu hình:
   ```
   Name: knowledge-system-demo
   AMI: Ubuntu Server 22.04 LTS
   Instance type: m7i-flex.large
   Key pair: Tạo mới (lưu file .pem)
   
   Security Group Rules:
   - SSH (22): My IP
   - HTTP (80): 0.0.0.0/0
   - TCP (7860): 0.0.0.0/0  ← Admin Web
   - TCP (7861): 0.0.0.0/0  ← User Web
   
   Storage: 20 GB gp3 (enough for demo, use 30-50GB for production)
   ```
4. Click **"Launch Instance"**

---

### Bước 2: Kết nối SSH (2 phút)

```bash
# Windows (PowerShell hoặc WSL)
chmod 400 knowledge-demo.pem
ssh -i knowledge-demo.pem ubuntu@<EC2_PUBLIC_IP>

# Tìm Public IP: EC2 Console → Instances → Instance của bạn
```

---

### Bước 3: Cài đặt môi trường (5 phút)

```bash
# Update hệ thống
sudo apt update && sudo apt upgrade -y

# Cài Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Logout và login lại để áp dụng docker group
exit
ssh -i knowledge-demo.pem ubuntu@<EC2_PUBLIC_IP>

# Cài Docker Compose và Python
sudo apt install -y docker-compose python3-pip

# Cài Ollama
curl -fsSL https://ollama.com/install.sh | sh
```

---

### Bước 4: Setup ứng dụng (10 phút)

```bash
# Clone repo
cd /home/ubuntu
git clone https://github.com/EgoisticAvida02/Tro-ly-tri-thuc-noi-bo-dua-tren-MCP-va-LLM.git knowledge-system
cd knowledge-system

# Pull LLaMA model (2GB download, ~5 phút)
ollama pull llama3.2:3b

# Khởi động Ollama server
nohup ollama serve > ollama.log 2>&1 &

# Cài Poetry (Python package manager)
curl -sSL https://install.python-poetry.org | python3 -

# Add Poetry to PATH
export PATH="/home/ubuntu/.local/bin:$PATH"

# Install dependencies với Poetry (skip installing the project itself)
poetry install --no-root

# Install Flask (for web interfaces)
poetry run pip install flask flask-cors

# Tạo thư mục data
mkdir -p data/documents data/chat_history
```

---

### Bước 5: Chạy services (3 phút)

```bash
# Khởi động Admin Web với Poetry
nohup poetry run python run_admin_web.py > admin.log 2>&1 &

# Khởi động User Web với Poetry
nohup poetry run python run_user_web.py > user.log 2>&1 &

# Kiểm tra đã chạy chưa
ps aux | grep python
```

---

### Bước 6: Truy cập & Test (5 phút)

```bash
# Lấy Public IP
curl http://checkip.amazonaws.com
```

**Mở trình duyệt:**
- **Admin Web**: `http://<EC2_IP>:7860`
  - User: `admin` / Pass: `admin123`
  
- **User Web**: `http://<EC2_IP>:7861`
  - User: `user1` / Pass: `user123`

**Test workflow:**
1. Admin Web → Upload tài liệu PDF
2. Đợi xử lý xong (~1-2 phút)
3. User Web → Đặt câu hỏi về tài liệu
4. Nhận câu trả lời trong < 10 giây ✅

---

## 💰 Tiết kiệm chi phí

**Tắt instance khi không demo:**
```bash
# Trên EC2 Console:
Actions → Instance State → Stop

# Bật lại trước khi demo:
Actions → Instance State → Start
```

**Chi phí thực tế:**
- Chạy 8 giờ/ngày × 7 ngày = 56 giờ
- 56 × $0.1197 = **~$7/tuần**
- Storage: $0.40/tuần (20GB)
- **Tổng: ~$7.50/tuần nếu chỉ bật khi cần**

---

## 🔧 Xử lý lỗi thường gặp

### Services không chạy:
```bash
# Xem logs
tail -f admin.log
tail -f user.log
tail -f ollama.log

# Restart
pkill -f run_admin_web
pkill -f run_user_web
nohup poetry run python run_admin_web.py > admin.log 2>&1 &
nohup poetry run python run_user_web.py > user.log 2>&1 &
```

### Chậm hơn 10 giây:
```bash
# Kiểm tra RAM
free -h

# Restart Ollama nếu RAM đầy
pkill ollama
nohup ollama serve > ollama.log 2>&1 &
```

### Không kết nối được:
```bash
# Kiểm tra Security Group trên EC2 Console
# Đảm bảo ports 7860, 7861 mở cho 0.0.0.0/0

# Kiểm tra services đang chạy
sudo netstat -tulpn | grep -E '7860|7861'
```

---

## 📊 Thông số kỹ thuật cho báo cáo

**Kiến trúc hệ thống:**
```
Browser → AWS EC2 (m7i-flex.large)
           ├── Admin Web (Flask - Python)
           ├── User Web (Flask - Python)
           ├── Ollama LLM (LLaMA 3.2 3B)
           ├── ChromaDB (Vector Database)
           └── SQLite (Metadata Storage)
```

**Cấu hình:**
- **Cloud**: AWS EC2
- **Instance**: m7i-flex.large (2 vCPU, 8GB RAM)
- **OS**: Ubuntu 22.04 LTS
- **LLM**: LLaMA 3.2 3B (3 tỷ parameters)
- **Embedding**: BAAI/bge-small-en-v1.5
- **Vector DB**: ChromaDB
- **Backend**: Flask (Python 3.10+)
- **Frontend**: HTML/CSS/JavaScript
- **Thời gian phản hồi**: < 10 giây (single user)
- **Chi phí**: ~$99/tháng (~$23/tuần cho demo)

**Performance metrics:**
- Concurrent users: 1
- Document processing: ~1-2 minutes per PDF
- Query response time: 7-10 seconds
- Vector search: < 1 second
- LLM inference: 5-8 seconds

---

## 📝 Checklist trước khi demo

- [ ] EC2 instance đang chạy (Status: Running)
- [ ] Admin Web truy cập được qua browser
- [ ] User Web truy cập được qua browser
- [ ] Đã upload ít nhất 2-3 tài liệu mẫu
- [ ] Test câu hỏi → Có câu trả lời đúng
- [ ] Thời gian trả lời < 10 giây
- [ ] Prepare backup questions nếu demo lỗi
- [ ] Screenshot/record video demo để backup

---

## 🎯 Demo Script Suggestions

**Scenario 1: Company Internal Knowledge**
1. Upload "Company Policies.pdf"
2. Ask: "What is the vacation policy?"
3. Show citation with page number

**Scenario 2: Technical Documentation**
1. Upload "API Documentation.pdf"
2. Ask: "How do I authenticate API requests?"
3. Show multiple document support

**Scenario 3: Real-time Updates**
1. Admin uploads new document
2. User immediately can query it
3. Show document list and stats

---

## 📞 Support

**Nếu gặp vấn đề nghiêm trọng:**
1. Check logs: `tail -f *.log`
2. Restart all services (commands ở trên)
3. Worst case: Terminate và tạo instance mới (15 phút)

**Lưu ý quan trọng:**
- Backup file `.pem` key pair cẩn thận
- Đừng commit API keys lên GitHub
- Tắt instance sau khi demo xong để tiết kiệm tiền
- Terminate instance sau khi bảo vệ xong

---

**Good luck với đồ án! 🎓✨**
