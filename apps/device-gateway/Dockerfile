FROM golang:1.26-alpine AS builder

ARG GATEWAY_COMMIT=1abeb8a551fbb5d017ae2031ded775a129555834
ARG GATEWAY_SOURCE_SHA256=f6d8dbe3e39569587b42ea67c683bc50903b6a30bc6b6f6d05666c72c8794444

RUN set -eux; \
    wget --tries=5 --timeout=30 \
      -O /tmp/lobehub-gateway.tar.gz \
      "https://github.com/lobehub/lobehub-gateway/archive/${GATEWAY_COMMIT}.tar.gz"; \
    echo "${GATEWAY_SOURCE_SHA256}  /tmp/lobehub-gateway.tar.gz" | sha256sum -c -; \
    mkdir -p /src; \
    tar -xzf /tmp/lobehub-gateway.tar.gz -C /src --strip-components=1; \
    cd /src/device-gateway-go; \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' \
      -o /out/device-gateway-go ./cmd/device-gateway-go

FROM alpine:3.24

RUN apk add --no-cache ca-certificates \
  && adduser -D -H -u 10001 appuser

USER appuser
ENV PORT=8788
EXPOSE 8788
COPY --from=builder /out/device-gateway-go /usr/local/bin/device-gateway-go
ENTRYPOINT ["device-gateway-go"]
