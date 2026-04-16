FROM nginx:alpine
COPY billing_processor.html /usr/share/nginx/html/index.html
EXPOSE 80
