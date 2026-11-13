# Layanan cron relayer. Konteks build = root repo (atau salinan minimal strukturnya),
# karena relayer mengimpor agents/firm/near_client.py, agents/firm/allora_lcd.py, dan membaca contracts/deployments/near_testnet.json.
FROM python:3.12-slim
WORKDIR /app
COPY relayer/requirements.txt relayer/requirements.txt
RUN pip install --no-cache-dir -r relayer/requirements.txt
COPY relayer/allora_relayer.py relayer/allora_relayer.py
COPY agents/firm/__init__.py agents/firm/__init__.py
COPY agents/firm/near_client.py agents/firm/near_client.py
COPY agents/firm/allora_lcd.py agents/firm/allora_lcd.py
COPY contracts/deployments/near_testnet.json contracts/deployments/near_testnet.json
ENV PYTHONUNBUFFERED=1
CMD ["python", "relayer/allora_relayer.py"]
