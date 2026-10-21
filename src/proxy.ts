/** Reject malformed /a/ and /r/ paths with a real 404 before rendering starts. */
import { NextResponse, type NextRequest } from "next/server";

const ADDRESS = /^\/a\/0x[0-9a-fA-F]{40}$/;
const RECEIPT = /^\/r\/0x[0-9a-fA-F]{64}\/\d+$/;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if ((pathname.startsWith("/a/") && !ADDRESS.test(pathname)) || (pathname.startsWith("/r/") && !RECEIPT.test(pathname))) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/a/:path*", "/r/:path*"] };
