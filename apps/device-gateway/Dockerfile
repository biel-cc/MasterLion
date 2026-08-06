ARG BASE_REGISTRY="docker.io/library"

FROM ${BASE_REGISTRY}/golang:1.26-alpine AS builder

ARG GATEWAY_COMMIT=1abeb8a551fbb5d017ae2031ded775a129555834

LABEL org.opencontainers.image.revision="${GATEWAY_COMMIT}" \
      org.opencontainers.image.source="https://github.com/lobehub/lobehub-gateway"

WORKDIR /src
COPY upstream/ ./

RUN set -eux; \
    sha256sum -c SOURCE_SHA256SUMS; \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' \
      -o /out/device-gateway-go ./cmd/device-gateway-go

FROM ${BASE_REGISTRY}/alpine:3.24

RUN apk add --no-cache ca-certificates \
  && adduser -D -H -u 10001 appuser

USER appuser
ENV PORT=8788
EXPOSE 8788
COPY --from=builder /out/device-gateway-go /usr/local/bin/device-gateway-go
ENTRYPOINT ["device-gateway-go"]
