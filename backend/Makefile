.PHONY: proto

# Regenerate gtfs_realtime_pb2.py from the official GTFS-RT proto.
#
# Requires grpcio-tools (dev dependency):
#   pip install -r requirements-dev.txt
#
# The generated file is committed to the repository so that the runtime
# only needs 'protobuf' (not grpcio-tools). Re-run this target whenever
# the upstream proto changes.
#
# Official proto source:
#   https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto
proto:
	@echo "Downloading gtfs-realtime.proto from google/transit..."
	curl -sSf "https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto" \
		-o /tmp/gtfs-realtime.proto
	@echo "Generating gtfs_realtime_pb2.py..."
	python3 -m grpc_tools.protoc \
		-I/tmp \
		--python_out=app/ \
		/tmp/gtfs-realtime.proto
	@echo "Generated: app/gtfs_realtime_pb2.py"
	@rm -f /tmp/gtfs-realtime.proto
