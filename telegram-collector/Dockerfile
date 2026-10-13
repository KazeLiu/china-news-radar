FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /collector
COPY telegram-collector/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home reader && mkdir /state && chown reader:reader /state
COPY telegram-collector/*.py ./
USER reader
ENV TG_STATE_DIR=/state TG_SESSION=/state/reader
CMD ["python", "main.py"]
