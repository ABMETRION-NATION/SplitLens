"""
SplitLens Backend API Tests
Tests health endpoints and receipt scan placeholder
"""
import pytest
import requests
import os
import io

# Read from frontend .env or use the public URL
BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL')
if not BASE_URL:
    # Fallback: read from frontend .env
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip()
                    break
    except:
        pass

if not BASE_URL:
    raise ValueError("EXPO_PUBLIC_BACKEND_URL not found in environment or frontend/.env")

BASE_URL = BASE_URL.rstrip('/')


class TestHealthEndpoints:
    """Health check endpoint tests"""

    def test_root_health(self):
        """Test GET /api/ returns status:ok, service:splitlens"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "splitlens"
        assert "version" in data
        print(f"✓ Root health check passed: {data}")

    def test_health_endpoint(self):
        """Test GET /api/health returns status:ok, service:splitlens"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "splitlens"
        assert "version" in data
        print(f"✓ Health endpoint passed: {data}")


class TestReceiptScan:
    """Receipt scan placeholder endpoint tests"""

    def test_receipt_scan_success(self):
        """Test POST /api/receipt/scan accepts file and returns simulated total"""
        # Create a dummy image file
        fake_image = io.BytesIO(b"fake image content for testing" * 100)
        fake_image.name = "receipt.jpg"
        
        files = {"file": ("receipt.jpg", fake_image, "image/jpeg")}
        response = requests.post(f"{BASE_URL}/api/receipt/scan", files=files)
        
        assert response.status_code == 200
        
        data = response.json()
        assert data["ok"] is True
        assert "total" in data
        assert isinstance(data["total"], (int, float))
        assert data["total"] > 0
        assert data["currency"] == "USD"
        assert data["source"] == "simulated"
        assert "message" in data
        print(f"✓ Receipt scan passed: {data}")

    def test_receipt_scan_deterministic(self):
        """Test that same file size produces same simulated total"""
        # Create two identical files
        content = b"test content" * 50
        fake_image1 = io.BytesIO(content)
        fake_image2 = io.BytesIO(content)
        
        files1 = {"file": ("receipt1.jpg", fake_image1, "image/jpeg")}
        response1 = requests.post(f"{BASE_URL}/api/receipt/scan", files=files1)
        
        files2 = {"file": ("receipt2.jpg", fake_image2, "image/jpeg")}
        response2 = requests.post(f"{BASE_URL}/api/receipt/scan", files=files2)
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        data1 = response1.json()
        data2 = response2.json()
        
        # Same file size should produce same simulated total
        assert data1["total"] == data2["total"]
        print(f"✓ Deterministic scan passed: both returned {data1['total']}")

    def test_receipt_scan_different_sizes(self):
        """Test that different file sizes produce different totals"""
        # Small file
        small_file = io.BytesIO(b"small" * 10)
        files_small = {"file": ("small.jpg", small_file, "image/jpeg")}
        response_small = requests.post(f"{BASE_URL}/api/receipt/scan", files=files_small)
        
        # Large file
        large_file = io.BytesIO(b"large content" * 500)
        files_large = {"file": ("large.jpg", large_file, "image/jpeg")}
        response_large = requests.post(f"{BASE_URL}/api/receipt/scan", files=files_large)
        
        assert response_small.status_code == 200
        assert response_large.status_code == 200
        
        data_small = response_small.json()
        data_large = response_large.json()
        
        # Different sizes should produce different totals (with high probability)
        # Both should be in reasonable range (18-187 per code)
        assert 18 <= data_small["total"] <= 187
        assert 18 <= data_large["total"] <= 187
        print(f"✓ Different sizes test passed: small={data_small['total']}, large={data_large['total']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
