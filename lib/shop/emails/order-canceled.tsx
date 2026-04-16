import type { ShopOrder } from "@/types/database"

interface Props {
  order: ShopOrder
  lookupUrl: string
}

export function OrderCanceledEmail({ order, lookupUrl }: Props) {
  const refundAmount = order.refund_amount_cents
    ? `$${(order.refund_amount_cents / 100).toFixed(2)}`
    : `$${(order.total_cents / 100).toFixed(2)}`

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Order Canceled — DJP Athlete</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#edece8" }}>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ backgroundColor: "#edece8" }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "48px 16px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  style={{
                    maxWidth: "600px",
                    width: "100%",
                    backgroundColor: "#ffffff",
                    borderRadius: "2px",
                    overflow: "hidden",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06)",
                  }}
                >
                  <tbody>
                    {/* Header */}
                    <tr>
                      <td style={{ backgroundColor: "#0E3F50", padding: 0 }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                        >
                          <tbody>
                            <tr>
                              <td
                                style={{
                                  height: "3px",
                                  background:
                                    "linear-gradient(90deg, #C49B7A 0%, #d4b08e 50%, #C49B7A 100%)",
                                }}
                              />
                            </tr>
                            <tr>
                              <td align="center" style={{ padding: "44px 48px 40px" }}>
                                <h1
                                  style={{
                                    margin: 0,
                                    fontFamily:
                                      "'Lexend Exa', Georgia, 'Times New Roman', serif",
                                    fontSize: "28px",
                                    fontWeight: 400,
                                    color: "#ffffff",
                                    letterSpacing: "8px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  DJP ATHLETE
                                </h1>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Body */}
                    <tr>
                      <td style={{ padding: "44px 48px 52px" }}>
                        <p
                          style={{
                            margin: "0 0 4px",
                            fontFamily:
                              "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            fontSize: "10px",
                            fontWeight: 600,
                            color: "#a09b94",
                            textTransform: "uppercase",
                            letterSpacing: "2px",
                          }}
                        >
                          Order Canceled
                        </p>
                        <p
                          style={{
                            margin: "0 0 8px",
                            fontFamily: "'Lexend Exa', Georgia, 'Times New Roman', serif",
                            fontSize: "22px",
                            fontWeight: 400,
                            color: "#0E3F50",
                          }}
                        >
                          Hi {order.customer_name},
                        </p>
                        <p
                          style={{
                            margin: "0 0 32px",
                            fontFamily:
                              "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            fontSize: "15px",
                            color: "#5c5750",
                            lineHeight: "1.8",
                          }}
                        >
                          Your order has been canceled. If you paid for this order, a refund of{" "}
                          <strong style={{ color: "#0E3F50" }}>{refundAmount}</strong> has been
                          initiated and will appear on your original payment method within 5&ndash;10
                          business days.
                        </p>

                        {/* Order info card */}
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                          style={{
                            backgroundColor: "#faf9f7",
                            borderRadius: "2px",
                            borderLeft: "3px solid #C49B7A",
                            marginBottom: "32px",
                          }}
                        >
                          <tbody>
                            <tr>
                              <td style={{ padding: "24px 28px" }}>
                                <p
                                  style={{
                                    margin: "0 0 4px",
                                    fontFamily:
                                      "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    color: "#a09b94",
                                    textTransform: "uppercase",
                                    letterSpacing: "2px",
                                  }}
                                >
                                  Order Number
                                </p>
                                <p
                                  style={{
                                    margin: "0 0 20px",
                                    fontFamily:
                                      "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                    fontSize: "16px",
                                    fontWeight: 600,
                                    color: "#0E3F50",
                                  }}
                                >
                                  {order.order_number}
                                </p>
                                <p
                                  style={{
                                    margin: "0 0 4px",
                                    fontFamily:
                                      "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    color: "#a09b94",
                                    textTransform: "uppercase",
                                    letterSpacing: "2px",
                                    borderTop: "1px solid #eae7e2",
                                    paddingTop: "16px",
                                  }}
                                >
                                  Refund
                                </p>
                                <p
                                  style={{
                                    margin: 0,
                                    fontFamily:
                                      "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                    fontSize: "16px",
                                    fontWeight: 600,
                                    color: "#166534",
                                  }}
                                >
                                  {refundAmount}
                                </p>
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        <p
                          style={{
                            margin: "0 0 32px",
                            fontFamily:
                              "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            fontSize: "14px",
                            color: "#78736c",
                            lineHeight: "1.7",
                          }}
                        >
                          If you have any questions, please reply to this email and we&rsquo;ll be
                          happy to help.
                        </p>

                        {/* CTA */}
                        <table
                          role="presentation"
                          cellPadding={0}
                          cellSpacing={0}
                          border={0}
                        >
                          <tbody>
                            <tr>
                              <td
                                align="center"
                                style={{ backgroundColor: "#0E3F50", borderRadius: "2px" }}
                              >
                                <a
                                  href={lookupUrl}
                                  target="_blank"
                                  style={{
                                    display: "inline-block",
                                    fontFamily:
                                      "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    color: "#ffffff",
                                    textDecoration: "none",
                                    padding: "14px 40px",
                                    letterSpacing: "1.5px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  View Order
                                </a>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Footer */}
                    <tr>
                      <td
                        style={{
                          padding: "32px 48px 40px",
                          borderTop: "1px solid #e8e5e0",
                          textAlign: "center",
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontFamily:
                              "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            fontSize: "11px",
                            color: "#a09b94",
                          }}
                        >
                          &copy; {new Date().getFullYear()} DJP Athlete. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}
