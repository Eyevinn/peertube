FROM chocobozzz/peertube:v8.3.1-trixie

COPY --chmod=755 osc/osc-entrypoint.sh /usr/local/bin/osc-entrypoint.sh
COPY osc/osc-setup.mjs /app/osc-setup.mjs

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT [ "/usr/local/bin/osc-entrypoint.sh" ]
CMD [ "node", "dist/server" ]
