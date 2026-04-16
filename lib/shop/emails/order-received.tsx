import type { ShopOrder } from "@/types/database"

interface Props {
  order: ShopOrder
  lookupUrl: string
}

export function OrderReceivedEmail({ order, lookupUrl }: Props) {
  const itemsHtml = order.items.map((item) => (
    <tr key={item.variant_id}>
      <td
        style={{
          padding: "12px 0",
          borderTop: "1px solid #eae7e2",
          fontFamily:
            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: "14px",
          color: "#5c5750",
        }}
      >
        {item.name} — {item.variant_name} &times; {item.quantity}
      </td>
      <td
        style={{
          padding: "12px 0",
          borderTop: "1px solid #eae7e2",
          fontFamily:
            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: "14px",
          color: "#0E3F50",
          textAlign: "right",
          fontWeight: 600,
        }}
      >
        ${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}
      </td>
    </tr>
  ))

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Order Received — DJP Athlete</title>
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
                {/* Email container */}
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

                    {/* Hero banner */}
                    <tr>
                      <td
                        style={{
                          backgroundColor: "#0E3F50",
                          padding: "36px 48px",
                          textAlign: "center",
                        }}
                      >
                        <p
                          style={{
                            margin: "0 0 10px",
                            fontFamily: "'Lexend Exa', Georgia, 'Times New Roman', serif",
                            fontSize: "10px",
                            color: "#C49B7A",
                            letterSpacing: "4px",
                            textTransform: "uppercase",
                          }}
                        >
                          Order Received
                        </p>
                        <h2
                          style={{
                            margin: 0,
                            fontFamily: "'Lexend Exa', Georgia, 'Times New Roman', serif",
                            fontSize: "24px",
                            fontWeight: 400,
                            color: "#ffffff",
                            lineHeight: "1.3",
                          }}
                        >
                          Thanks for your order!
                        </h2>
                      </td>
                    </tr>

                    {/* Body */}
                    <tr>
                      <td style={{ padding: "44px 48px 52px" }}>
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
                          We&rsquo;ve received your order and it&rsquo;s being reviewed. You&rsquo;ll
                          get another email once it&rsquo;s confirmed and sent to production.
                        </p>

                        {/* Order summary card */}
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
                            marginBottom: "28px",
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
                                    margin: "0 0 16px",
                                    fontFamily:
                                      "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                    fontSize: "16px",
                                    fontWeight: 600,
                                    color: "#0E3F50",
                                  }}
                                >
                                  {order.order_number}
                                </p>

                                {/* Items */}
                                <table
                                  role="presentation"
                                  width="100%"
                                  cellPadding={0}
                                  cellSpacing={0}
                                  border={0}
                                >
                                  <tbody>{itemsHtml}</tbody>
                                </table>

                                {/* Totals */}
                                <table
                                  role="presentation"
                                  width="100%"
                                  cellPadding={0}
                                  cellSpacing={0}
                                  border={0}
                                  style={{ marginTop: "16px", borderTop: "2px solid #eae7e2" }}
                                >
                                  <tbody>
                                    <tr>
                                      <td
                                        style={{
                                          padding: "12px 0 4px",
                                          fontFamily:
                                            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                          fontSize: "13px",
                                          color: "#78736c",
                                        }}
                                      >
                                        Subtotal
                                      </td>
                                      <td
                                        style={{
                                          padding: "12px 0 4px",
                                          fontFamily:
                                            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                          fontSize: "13px",
                                          color: "#78736c",
                                          textAlign: "right",
                                        }}
                                      >
                                        ${(order.subtotal_cents / 100).toFixed(2)}
                                      </td>
                                    </tr>
                                    <tr>
                                      <td
                                        style={{
                                          padding: "4px 0",
                                          fontFamily:
                                            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                          fontSize: "13px",
                                          color: "#78736c",
                                        }}
                                      >
                                        Shipping
                                      </td>
                                      <td
                                        style={{
                                          padding: "4px 0",
                                          fontFamily:
                                            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                          fontSize: "13px",
                                          color: "#78736c",
                                          textAlign: "right",
                                        }}
                                      >
                                        ${(order.shipping_cents / 100).toFixed(2)}
                                      </td>
                                    </tr>
                                    <tr>
                                      <td
                                        style={{
                                          padding: "8px 0 0",
                                          fontFamily:
                                            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                          fontSize: "15px",
                                          fontWeight: 600,
                                          color: "#0E3F50",
                                        }}
                                      >
                                        Total
                                      </td>
                                      <td
                                        style={{
                                          padding: "8px 0 0",
                                          fontFamily:
                                            "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                                          fontSize: "15px",
                                          fontWeight: 600,
                                          color: "#0E3F50",
                                          textAlign: "right",
                                        }}
                                      >
                                        ${(order.total_cents / 100).toFixed(2)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          </tbody>
                        </table>

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
                                  View Order Status
                                </a>
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        <p
                          style={{
                            margin: "28px 0 0",
                            fontFamily:
                              "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            fontSize: "11px",
                            color: "#b5b0a8",
                            lineHeight: "1.6",
                          }}
                        >
                          Button not working? Copy and paste this link:
                          <br />
                          <a href={lookupUrl} style={{ color: "#0E3F50", wordBreak: "break-all", fontSize: "11px" }}>
                            {lookupUrl}
                          </a>
                        </p>
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
                            margin: "0 0 6px",
                            fontFamily:
                              "'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            fontSize: "11px",
                            color: "#a09b94",
                            letterSpacing: "0.5px",
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
